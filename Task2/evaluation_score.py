# evaluation_score.py
# -*- coding: utf-8 -*-
"""
Token-level precision/recall per Test sheet (Test1/2/3) + micro summary (per topic)
and an aggregated SHOT_SUMMARY across all topics for model+shot.

- Reads GT.
- Reads LLM files from: LLM Output/<RUN_LLM_MODEL>/<RUN_SHOT>/*.xlsx
- For each file (topic), writes: Evaluation Score/<model>/<shot>/{model}_{shot}_{topic}_eval.xlsx
  with sheets: Test1, Test2, Test3, and SUMMARY_MICRO (per-topic micro).

- After all topics are processed, writes:
  Evaluation Score/<model>/{model}_{shot}_SHOT_SUMMARY_MICRO.xlsx
  containing:
    • PER_TOPIC_MICRO: one row per (topic, test) with micro Pt/Pb/Rt/Rb and P/R/F
    • SHOT_SUMMARY_MICRO: one row per Test (summing across topics) + BEST-OF-3
"""

from __future__ import annotations
import argparse, re, unicodedata
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd

RUN_LLM_MODEL = "Qwen2.5-7b"    
RUN_SHOT      = "1-shot"      
RUN_TOPIC     = None          
THRESHOLD     = 0.50         
DEDUP_PRED    = True          

# Embedding backbone for token embeddings
BERT_MODEL = "sentence-transformers/all-MiniLM-L6-v2"

# Topic canonicalization
_CANONICAL_TOPICS = {
    "room","price","food","facility","staff","location",
    "check-in","check-out","booking","taxi"
}
_VARIANT_TO_CANONICAL: Dict[str,str] = {
    "check in":"check-in","check-in":"check-in","check_in":"check-in","checkin":"check-in",
    "check out":"check-out","check-out":"check-out","check_out":"check-out","checkout":"check-out",
    "booking":"booking","booking issue":"booking","booking_issue":"booking",
    "taxi":"taxi","taxi issue":"taxi","taxi_issue":"taxi",
    "room":"room","price":"price","food":"food","facility":"facility","staff":"staff","location":"location",
}

def canonicalize_topic_body(raw: str) -> Optional[str]:
    if raw is None: return None
    s = str(raw).strip().lower()
    if not s: return None
    s = s.replace("_"," ").replace("/", " ").replace(",", " ")
    s = re.sub(r"\s+"," ", s)
    if s in _VARIANT_TO_CANONICAL: return _VARIANT_TO_CANONICAL[s]
    s_alt = s.replace("-", " ")
    if s_alt in _VARIANT_TO_CANONICAL: return _VARIANT_TO_CANONICAL[s_alt]
    tokens = s_alt.split()
    for cand in _CANONICAL_TOPICS:
        ctoks = cand.replace("-", " ").split()
        if all(t in tokens for t in ctoks):
            return cand
    return s.replace(" ", "-")

# File/topic helpers 
def deduce_topic_from_filename(p: Path) -> str:
    """
    Robustly infer topic from file name.
    Handles: check_in_* vs check_out_*, checkin/checkout, underscores/hyphens.
    """
    s = p.stem.lower()
    if "check_out" in s or "checkout" in s or "check-out" in s:
        return "check-out"
    if "check_in" in s or "checkin" in s or "check-in" in s:
        return "check-in"
    parts = re.split(r"[_\-\s]+", s)
    head = parts[0] if parts else s
    if head == "check" and len(parts) >= 2 and parts[1] in {"in", "out"}:
        head = f"check_{parts[1]}"
    return canonicalize_topic_body(head) or head

def sanitize_sheet_name(name: str) -> str:
    bad = set(r'[]:*?/\\')
    s = "".join("_" if c in bad else c for c in name)
    return s[:31] or "sheet"

# Excel writer 
def _open_writer(path: Path):
    try:
        import xlsxwriter  # noqa: F401
        engine = "xlsxwriter"
    except Exception:
        import openpyxl  # noqa: F401
        engine = "openpyxl"
    return pd.ExcelWriter(path, engine=engine)

# Match gate from your previous pipeline (join GT vs LLM) 
_GOOD_BAD_PREFIX_RE = re.compile(r"^\s*(good|bad)[\s_\-:]+", re.IGNORECASE)
_TEXT_MARKER = "[Text]"
_TRAILING_PUNCT_RE = re.compile(r"[,\.\s]+$")

def _strip_good_bad_prefix(text: str) -> str:
    return _GOOD_BAD_PREFIX_RE.sub("", str(text)).strip()

def extract_polarity(raw: str) -> str:
    m = _GOOD_BAD_PREFIX_RE.match(str(raw).strip().lower()) if raw is not None else None
    return m.group(1) if m else ""

def extract_text_after_marker(prompt: str) -> str:
    if prompt is None or (isinstance(prompt, float) and pd.isna(prompt)):
        return ""
    s = str(prompt)
    idx = s.rfind(_TEXT_MARKER)
    if idx == -1:
        return ""
    return s[idx + len(_TEXT_MARKER):].strip()

def normalize_for_gate(s: str) -> str:
    if s is None or (isinstance(s, float) and pd.isna(s)):
        return ""
    s = unicodedata.normalize("NFKC", str(s)).replace("\u00A0", " ")
    s = s.strip()
    s = " ".join(s.split())
    s = _TRAILING_PUNCT_RE.sub("", s)
    return s

def canon_id(x) -> str:
    s = str(x).strip()
    try:
        f = float(s)
        if abs(f - round(f)) < 1e-12:
            return str(int(round(f)))
        return s
    except Exception:
        return s

def make_topic_key(raw_with_prefix: str) -> Optional[str]:
    if raw_with_prefix is None:
        return None
    pol  = extract_polarity(raw_with_prefix)
    body = canonicalize_topic_body(_strip_good_bad_prefix(raw_with_prefix))
    if body is None:
        return None
    return f"{pol}_{body}" if pol else body

def load_gt(gt_path: Path, sheet: str) -> pd.DataFrame:
    df = pd.read_excel(gt_path, sheet_name=sheet)
    missing = [c for c in ("Column1", "Head", "Concat", "Selected Content") if c not in df.columns]
    if missing: raise ValueError(f"GT missing columns: {missing}")
    out = df[["Column1", "Head", "Concat", "Selected Content"]].copy()
    out["Column1_canon"] = out["Column1"].map(canon_id)
    out["topic_key"]     = out["Head"].apply(make_topic_key)            # preserve prefix
    out["text_key"]      = out["Selected Content"].apply(normalize_for_gate)
    return out[(out["topic_key"].notna()) & (out["text_key"] != "")]

def load_llm(path: Path) -> pd.DataFrame:
    df = pd.read_excel(path)
    required = ["ID", "Topic", "Prompt"]
    for col in required:
        if col not in df.columns:
            raise ValueError(f"{path.name}: missing required column '{col}'.")
    # normalize test column names
    col_map = {}
    for n in (1, 2, 3):
        if f"Test {n}" in df.columns: col_map[f"Test {n}"] = f"Test{n}"
        elif f"Test{n}" in df.columns: col_map[f"Test{n}"] = f"Test{n}"
    df = df.rename(columns=col_map)
    for n in (1, 2, 3):
        if f"Test{n}" not in df.columns: df[f"Test{n}"] = ""
    out = df[["ID", "Topic", "Prompt", "Test1", "Test2", "Test3"]].copy()
    out["ID_canon"]  = out["ID"].map(canon_id)
    out["topic_key"] = out["Topic"].apply(make_topic_key)
    out["_raw_text"] = out["Prompt"].apply(extract_text_after_marker)
    out["text_key"]  = out["_raw_text"].apply(normalize_for_gate)
    return out[(out["topic_key"].notna()) & (out["text_key"] != "")]

# Token parsing & normalization
# Handle both polarity prefixes
_PREFIX_SPECS: Dict[str, List[str]] = {
    "no_evident_not": ["no_evident_not", "no-evident-not"],
    "have_evident":   ["have_evident",   "have-evident"],
}

def norm_token(tok: str) -> str:
    if tok is None: return ""
    s = str(tok).strip().lower()
    s = re.sub(r"[;|]", ",", s)
    s = s.replace("-", "_")
    s = re.sub(r"__+", "_", s)
    s = s.strip("_")
    return s

def split_prefix(tok: str) -> Tuple[str,str]:
    s = norm_token(tok)
    for norm, forms in _PREFIX_SPECS.items():
        for f in forms:
            f_ = f.replace("-", "_")
            if s.startswith(f_ + "_"):
                return norm, s[len(f_)+1:]
            if s == f_:
                return norm, ""
    return "", s

def token_for_embed(tok: str) -> str:
    prefix, tail = split_prefix(tok)
    txt = tail.replace("_", " ").strip()
    if prefix == "no_evident_not":
        return ("no evident not " + txt) if txt else "no evident not"
    if prefix == "have_evident":
        return ("have evident " + txt) if txt else "have evident"
    return txt

def parse_token_list(cell: str) -> List[str]:
    if cell is None or (isinstance(cell, float) and pd.isna(cell)):
        return []
    s = str(cell)
    parts = [norm_token(x) for x in re.split(r"\s*,\s*", s)]
    return [p for p in parts if p]

# Embeddings & cosine
_EMBEDDER = None
def _get_embedder():
    global _EMBEDDER
    if _EMBEDDER is not None:
        return _EMBEDDER
    try:
        import torch
        from sentence_transformers import SentenceTransformer
    except Exception as e:
        raise RuntimeError("Missing dependency. Please install:\n  pip install sentence-transformers") from e
    device = "cpu"
    try:
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
    except Exception:
        device = "cpu"
    from sentence_transformers import SentenceTransformer
    _EMBEDDER = SentenceTransformer(BERT_MODEL, device=device)
    return _EMBEDDER

def cosine_matrix(a_texts: List[str], b_texts: List[str]) -> np.ndarray:
    if not a_texts or not b_texts:
        return np.zeros((len(a_texts), len(b_texts)), dtype=float)
    model = _get_embedder()
    A = model.encode(a_texts, normalize_embeddings=True, show_progress_bar=False)
    B = model.encode(b_texts, normalize_embeddings=True, show_progress_bar=False)
    A = np.asarray(A); B = np.asarray(B)
    return A @ B.T

# One-to-one matching (greedy best-first) 
def count_matches(gt_tokens: List[str], pred_tokens: List[str], threshold: float) -> Tuple[int, List[Tuple[int,int,float]]]:
    if not gt_tokens or not pred_tokens:
        return 0, []
    gt_pref = [split_prefix(t)[0] for t in gt_tokens]
    pr_pref = [split_prefix(t)[0] for t in pred_tokens]
    gt_emb_texts = [token_for_embed(t) for t in gt_tokens]
    pr_emb_texts = [token_for_embed(t) for t in pred_tokens]
    S = cosine_matrix(gt_emb_texts, pr_emb_texts)  # (G,P)
    for i in range(len(gt_tokens)):
        for j in range(len(pred_tokens)):
            if gt_pref[i] != pr_pref[j]:
                S[i, j] = -1.0
    candidates = []
    G, P = S.shape
    for i in range(G):
        for j in range(P):
            if S[i, j] >= threshold:
                candidates.append((float(S[i,j]), i, j))
    candidates.sort(reverse=True)
    used_g = set(); used_p = set()
    matches: List[Tuple[int,int,float]] = []
    for sim, i, j in candidates:
        if i in used_g or j in used_p:
            continue
        used_g.add(i); used_p.add(j)
        matches.append((i, j, float(sim)))
    return len(matches), matches

# Micro P/R/F helper 
def _prf(sum_pt: int, sum_pb: int, sum_rb: int) -> Tuple[float, float, float]:
    P = (sum_pt / sum_pb) if sum_pb > 0 else 0.0
    R = (sum_pt / sum_rb) if sum_rb > 0 else 0.0
    F = (2 * P * R / (P + R)) if (P + R) > 0 else 0.0
    return P, R, F

# Scoring one workbook (topic)
def score_one_workbook(gt_df: pd.DataFrame, llm_path: Path, out_root: Path, mirror_root: Path,
                       threshold: float, dedup_pred: bool) -> Tuple[Path, str, Dict[str, Dict[str, int]]]:
    llm_df = load_llm(llm_path)
    topic_pretty = deduce_topic_from_filename(llm_path)
    model_label  = llm_path.parent.parent.name.replace("-", "_")

    merged = pd.merge(
        gt_df, llm_df,
        left_on=["Column1_canon", "topic_key", "text_key"],
        right_on=["ID_canon",     "topic_key", "text_key"],
        how="inner", suffixes=("_gt","_llm")
    )

    shot_dir  = llm_path.parent.name
    out_dir   = out_root / model_label / shot_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    shot_name    = shot_dir.replace("-", "_")
    topic_for_fn = (topic_pretty or "topic").replace("-", "_")

    # Per-topic filename: {model}_{shot}_{topic}_eval.xlsx
    out_path = out_dir / f"{model_label}_{shot_name}_{topic_for_fn}_eval.xlsx"

    micro = {"Test1": {"Pt": 0, "Pb": 0, "Rb": 0, "n": 0},
             "Test2": {"Pt": 0, "Pb": 0, "Rb": 0, "n": 0},
             "Test3": {"Pt": 0, "Pb": 0, "Rb": 0, "n": 0}}

    with _open_writer(out_path) as writer:
        for test_col, sheet_name in [("Test1","Test1"), ("Test2","Test2"), ("Test3","Test3")]:
            rows = []
            for _, r in merged.iterrows():
                idv   = r["ID"]
                head  = r["Head"]
                gt_s  = r["Concat"] if pd.notna(r["Concat"]) else ""
                pr_s  = r[test_col]  if pd.notna(r[test_col])  else ""

                gt_tokens   = parse_token_list(gt_s)
                pred_tokens = parse_token_list(pr_s)
                if dedup_pred:
                    pred_tokens = list(dict.fromkeys(pred_tokens))

                Rb = len(set(gt_tokens))
                Pb = len(pred_tokens)
                Pt, _matches = count_matches(gt_tokens, pred_tokens, threshold)

                Rt = Pt
                precision = (Pt / Pb) if Pb > 0 else 0.0
                recall    = (Rt / Rb) if Rb > 0 else 0.0

                rows.append({
                    "ID": idv,
                    "Head": head,
                    "GT": ", ".join(gt_tokens),
                    "Pred": ", ".join(pred_tokens),
                    "Pt": Pt,
                    "Pb": Pb,
                    "Precision": round(float(precision), 6),
                    "Rt": Rt,
                    "Rb": Rb,
                    "Recall": round(float(recall), 6),
                })

                micro[sheet_name]["Pt"] += Pt
                micro[sheet_name]["Pb"] += Pb
                micro[sheet_name]["Rb"] += Rb
                micro[sheet_name]["n"]  += 1

            df_out = pd.DataFrame(rows, columns=["ID","Head","GT","Pred","Pt","Pb","Precision","Rt","Rb","Recall"])
            df_out.to_excel(writer, sheet_name=sanitize_sheet_name(sheet_name), index=False)

        # Per-topic SUMMARY_MICRO (for that topic)
        summary_rows = []
        best_key = None
        best_info = None  # (test, P, R, F)
        for t in ("Test1","Test2","Test3"):
            s = micro[t]
            P, R, F = _prf(s["Pt"], s["Pb"], s["Rb"])
            summary_rows.append({
                "Test": t,
                "Micro Precision": round(P, 6),
                "Micro Recall":    round(R, 6),
                "Micro F1":        round(F, 6),
                "Pt": int(s["Pt"]), "Pb": int(s["Pb"]), "Rt": int(s["Pt"]), "Rb": int(s["Rb"]),
                "n_rows": int(s["n"]),
            })
            key = (F, R, P)
            if best_key is None or key > best_key:
                best_key = key
                best_info = (t, P, R, F)
        if best_info is not None:
            t, P, R, F = best_info
            summary_rows.append({
                "Test": f"BEST-OF-3 = {t}",
                "Micro Precision": round(P, 6),
                "Micro Recall":    round(R, 6),
                "Micro F1":        round(F, 6),
                "Pt": "", "Pb": "", "Rt": "", "Rb": "", "n_rows": ""
            })

        df_summary = pd.DataFrame(
            summary_rows,
            columns=["Test","Micro Precision","Micro Recall","Micro F1","Pt","Pb","Rt","Rb","n_rows"]
        )
        df_summary.to_excel(writer, sheet_name="SUMMARY_MICRO", index=False)

    print(f"[OK] {llm_path} -> {out_path}")
    return out_path, (topic_pretty or "topic"), micro

# Defaults & file discovery 
def guess_defaults(cwd: Path):
    gt = None
    def good_gt_name(name: str) -> bool:
        name_l = name.lower()
        return ("original aba dataset for version 2" in name_l and
                "senior project" in name_l and "muict" in name_l)
    candidates = []
    for p in cwd.rglob("*.xlsx"):
        if p.name.startswith("~$"):
            continue
        if good_gt_name(p.name):
            candidates.append(p)
    if candidates:
        candidates.sort(key=lambda x: (len(x.name), x.stat().st_mtime), reverse=True)
        gt = candidates[0]
    gt_sheet = "Sheet2"
    llm_root_base   = cwd / "LLM Output"
    llm_search_root = llm_root_base / RUN_LLM_MODEL / RUN_SHOT
    if not llm_search_root.exists():
        llm_search_root = llm_root_base
    mirror_root = llm_root_base
    out_root = cwd / "Evaluation Score"
    return gt, gt_sheet, llm_search_root, out_root, mirror_root

def find_llm_files(root: Path, topic_filter: Optional[str] = None) -> List[Path]:
    files: List[Path] = []
    for p in root.glob("*.xlsx"):
        if p.name.startswith("~$"):
            continue
        if "token_eval_t" in p.name.lower():
            continue
        if not p.name.lower().endswith(".xlsx"):
            continue
        if topic_filter:
            t = deduce_topic_from_filename(p)
            if canonicalize_topic_body(topic_filter) != canonicalize_topic_body(t):
                continue
        files.append(p)
    return sorted(files)

# CLI 
def main():
    ap = argparse.ArgumentParser(description="Token-level Precision/Recall per Test sheet with micro summary + shot-level summary.")
    ap.add_argument("--gt", type=Path, help="Path to GT Excel file")
    ap.add_argument("--gt-sheet", default="Sheet2", help="Sheet name in GT file")
    ap.add_argument("--t", type=float, default=THRESHOLD, help="Cosine threshold (default from script)")
    ap.add_argument("--dedup", action="store_true", help="De-duplicate predicted tokens (overrides script default)")
    args = ap.parse_args()

    cwd = Path.cwd()
    gt_path, gt_sheet, llm_path_root, out_dir, mirror_root = guess_defaults(cwd)
    if args.gt: gt_path = args.gt
    if args.gt_sheet: gt_sheet = args.gt_sheet

    if gt_path is None or not gt_path.exists():
        raise SystemExit("ERROR: GT file not found. Pass --gt or place it under the project tree.")

    threshold = float(args.t if args.t is not None else THRESHOLD)
    dedup_pred = bool(args.dedup or DEDUP_PRED)

    print(f"[INFO] GT: {gt_path} (sheet={gt_sheet}) | threshold={threshold} | model={RUN_LLM_MODEL} | shot={RUN_SHOT} | topic={RUN_TOPIC} | backbone={BERT_MODEL}")
    gt_df = load_gt(gt_path, gt_sheet)

    # Locate input files for this model/shot[/topic]
    search_root = (cwd / "LLM Output" / RUN_LLM_MODEL / RUN_SHOT)
    if not search_root.exists():
        raise SystemExit(f"ERROR: Folder not found: {search_root}")
    files = find_llm_files(search_root, topic_filter=RUN_TOPIC)
    if not files:
        print(f"[WARN] No topic files under {search_root} (topic={RUN_TOPIC})")
        return

    # Process each topic file and collect per-topic micro
    per_topic_records = []  # rows for PER_TOPIC_MICRO
    shot_sums = { "Test1": {"Pt":0,"Pb":0,"Rb":0,"n":0},
                  "Test2": {"Pt":0,"Pb":0,"Rb":0,"n":0},
                  "Test3": {"Pt":0,"Pb":0,"Rb":0,"n":0} }

    model_label = RUN_LLM_MODEL.replace("-", "_")
    shot_name   = RUN_SHOT.replace("-", "_")

    for f in files:
        try:
            out_path, topic_display, micro = score_one_workbook(
                gt_df, f, out_dir, mirror_root, threshold, dedup_pred
            )
            # Build PER_TOPIC_MICRO rows
            for t in ("Test1","Test2","Test3"):
                s = micro[t]
                P, R, F = _prf(s["Pt"], s["Pb"], s["Rb"])
                per_topic_records.append({
                    "Model": model_label,
                    "Shot": shot_name,
                    "Topic": topic_display,
                    "Test": t,
                    "Pt": int(s["Pt"]),
                    "Pb": int(s["Pb"]),
                    "Rt": int(s["Pt"]),
                    "Rb": int(s["Rb"]),
                    "n_rows": int(s["n"]),
                    "Micro Precision": round(P, 6),
                    "Micro Recall":    round(R, 6),
                    "Micro F1":        round(F, 6),
                })
                # Accumulate shot sums
                shot_sums[t]["Pt"] += s["Pt"]
                shot_sums[t]["Pb"] += s["Pb"]
                shot_sums[t]["Rb"] += s["Rb"]
                shot_sums[t]["n"]  += s["n"]

        except Exception as e:
            print(f"[ERROR] {f}: {e}")

    # ---------- WRITE SHOT-LEVEL SUMMARY ----------
    # Where: Evaluation Score/<model>/{model}_{shot}_SHOT_SUMMARY_MICRO.xlsx
    summary_dir = (out_dir / model_label)
    summary_dir.mkdir(parents=True, exist_ok=True)
    sum_path = summary_dir / f"{model_label}_{shot_name}_SHOT_SUMMARY_MICRO.xlsx"

    with _open_writer(sum_path) as writer:
        # PER_TOPIC_MICRO sheet
        df_per_topic = pd.DataFrame(
            per_topic_records,
            columns=["Model","Shot","Topic","Test","Pt","Pb","Rt","Rb","n_rows",
                     "Micro Precision","Micro Recall","Micro F1"]
        )
        df_per_topic.to_excel(writer, sheet_name="PER_TOPIC_MICRO", index=False)

        # SHOT_SUMMARY_MICRO sheet
        summary_rows = []
        best_key = None
        best_info = None
        for t in ("Test1","Test2","Test3"):
            s = shot_sums[t]
            P, R, F = _prf(s["Pt"], s["Pb"], s["Rb"])
            summary_rows.append({
                "Test": t,
                "Micro Precision": round(P, 6),
                "Micro Recall":    round(R, 6),
                "Micro F1":        round(F, 6),
                "Pt": int(s["Pt"]), "Pb": int(s["Pb"]), "Rt": int(s["Pt"]), "Rb": int(s["Rb"]),
                "n_rows": int(s["n"]),
            })
            key = (F, R, P)
            if best_key is None or key > best_key:
                best_key = key
                best_info = (t, P, R, F)
        if best_info is not None:
            t, P, R, F = best_info
            summary_rows.append({
                "Test": f"BEST-OF-3 = {t}",
                "Micro Precision": round(P, 6),
                "Micro Recall":    round(R, 6),
                "Micro F1":        round(F, 6),
                "Pt": "", "Pb": "", "Rt": "", "Rb": "", "n_rows": ""
            })

        df_shot = pd.DataFrame(
            summary_rows,
            columns=["Test","Micro Precision","Micro Recall","Micro F1","Pt","Pb","Rt","Rb","n_rows"]
        )
        df_shot.to_excel(writer, sheet_name="SHOT_SUMMARY_MICRO", index=False)

    print(f"[OK] Wrote shot summary -> {sum_path}")

if __name__ == "__main__":
    main()