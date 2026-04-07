#!/usr/bin/env python3
"""Compute ABA extensions for selectable semantics using py_arg.

Input: JSON via stdin with keys:
  - language: [str]
  - assumptions: [str]
  - contraries: {assumption: contrary_atom}
  - rules: [{name, premises, conclusion}]
  - query: optional str

Output: JSON to stdout.
"""

from __future__ import annotations

import json
import sys
from typing import Dict, Iterable, List, Set

from py_arg.aba_classes.aba_framework import ABAF
from py_arg.aba_classes.rule import Rule
import py_arg.aba_classes.semantics.get_stable_extensions as get_stable_extensions
import py_arg.aba_classes.semantics.get_complete_extensions as get_complete_extensions
import py_arg.aba_classes.semantics.get_conflict_free_extensions as get_conflict_free_extensions
import py_arg.aba_classes.semantics.get_admissible_extensions as get_admissible_extensions
import py_arg.aba_classes.semantics.get_preferred_extensions as get_preferred_extensions
import py_arg.aba_classes.semantics.get_semi_stable_extensions as get_semi_stable_extensions
import py_arg.aba_classes.semantics.get_grounded_extensions as get_ground_extensions
import py_arg.aba_classes.semantics.get_naive_extensions as get_naive_extensions


def get_grounded_extensions_compat(abaf: ABAF):
    """Compatibility wrapper across py_arg versions."""
    # Some py_arg versions expose grounded for ABA as a strangely named
    # `get_preferred_extensions` function in this module.
    direct_candidates = (
        "get_grounded_extensions",
        "get_grounded_extension",
        "get_extension",
        "get_preferred_extensions",
    )
    for name in direct_candidates:
        fn = getattr(get_ground_extensions, name, None)
        if callable(fn):
            return fn(abaf)

    # Other versions expose a nested module `get_grounded_extensions_af`
    # with function `get_grounded_extension(af)` that needs AF input.
    nested_mod = getattr(get_ground_extensions, "get_grounded_extensions_af", None)
    nested_fn = getattr(nested_mod, "get_grounded_extension", None) if nested_mod else None
    if callable(nested_fn):
        af = abaf.generate_af()
        af_ext = nested_fn(af)
        abaf_ext = {arg.conclusion for arg in af_ext if getattr(arg, "conclusion", None) in abaf.assumptions}
        return {frozenset(abaf_ext)}
    raise AttributeError(
        "py_arg grounded semantics API not found "
        "(expected one of: get_grounded_extensions, get_grounded_extension, get_extension)"
    )


def get_abaf_extensions(abaf: ABAF, semantics_specification: str):
    if semantics_specification == "Stable":
        return get_stable_extensions.get_stable_extensions(abaf)
    if semantics_specification == "Preferred":
        return get_preferred_extensions.get_preferred_extensions(abaf)
    if semantics_specification == "Conflict-Free":
        return get_conflict_free_extensions.get_conflict_free_extensions(abaf)
    if semantics_specification == "Naive":
        return get_naive_extensions.get_naive_extensions(abaf)
    if semantics_specification == "Admissible":
        return get_admissible_extensions.get_admissible_extensions(abaf)
    if semantics_specification == "Complete":
        return get_complete_extensions.get_complete_extensions(abaf)
    if semantics_specification == "SemiStable":
        return get_semi_stable_extensions.get_semi_stable_extensions(abaf)
    if semantics_specification == "Grounded":
        return get_grounded_extensions_compat(abaf)
    raise ValueError(f"Unsupported semantics_specification: {semantics_specification}")


def get_accepted_assumptions(extensions, strategy_specification: str):
    ext_list = list(extensions or [])
    if not ext_list:
        return frozenset()

    if strategy_specification == "Skeptical":
        common = set(ext_list[0])
        for ext in ext_list[1:]:
            common.intersection_update(ext)
        return frozenset(common)

    if strategy_specification == "Credulous":
        merged = set()
        for ext in ext_list:
            merged.update(ext)
        return frozenset(merged)

    raise ValueError("strategy_specification must be 'Skeptical' or 'Credulous'")


def forward_closure(base: Set[str], rules: Iterable[Dict[str, object]]) -> Set[str]:
    """Derive atoms reachable from an assumption extension via forward chaining."""
    derived = set(base)
    changed = True
    while changed:
        changed = False
        for r in rules:
            premises = set(r.get("premises", []))
            conclusion = str(r.get("conclusion", ""))
            if conclusion and premises.issubset(derived) and conclusion not in derived:
                derived.add(conclusion)
                changed = True
    return derived


def validate(payload: Dict[str, object]) -> None:
    language = set(payload.get("language", []))
    assumptions = set(payload.get("assumptions", []))
    contraries = payload.get("contraries", {}) or {}
    rules = payload.get("rules", []) or []

    missing_contraries = sorted(a for a in assumptions if a not in contraries)
    if missing_contraries:
        raise ValueError(
            "Missing contrary mapping for assumptions: " + ", ".join(missing_contraries)
        )

    invalid_rule_atoms: List[str] = []
    for idx, r in enumerate(rules, start=1):
        premises = set(r.get("premises", []))
        conclusion = str(r.get("conclusion", ""))
        unknown = sorted(x for x in premises | {conclusion} if x and x not in language)
        if unknown:
            invalid_rule_atoms.append(f"rule[{idx}] unknown atoms: {', '.join(unknown)}")
    if invalid_rule_atoms:
        raise ValueError("; ".join(invalid_rule_atoms))

    semantics = str(payload.get("semantics_specification", "Preferred")).strip()
    if not semantics:
        raise ValueError("semantics_specification must not be empty")

    strategy = str(payload.get("strategy_specification", "Credulous")).strip()
    if strategy not in {"Credulous", "Skeptical"}:
        raise ValueError(
            "strategy_specification must be 'Credulous' or 'Skeptical'"
        )


def main() -> int:
    try:
        raw = sys.stdin.read().strip()
        payload = json.loads(raw) if raw else {}
        validate(payload)

        language = set(payload.get("language", []))
        assumptions = set(payload.get("assumptions", []))
        contraries = dict(payload.get("contraries", {}))
        rule_defs = payload.get("rules", []) or []

        rules = set()
        for idx, r in enumerate(rule_defs, start=1):
            name = str(r.get("name") or f"Rule{idx}")
            premises = set(r.get("premises", []))
            conclusion = str(r.get("conclusion", ""))
            rules.add(Rule(name, premises, conclusion))

        framework = ABAF(assumptions, rules, language, contraries)
        semantics_specification = str(
            payload.get("semantics_specification", "Preferred")
        ).strip() or "Preferred"
        strategy_specification = str(
            payload.get("strategy_specification", "Credulous")
        ).strip() or "Credulous"
        exts = get_abaf_extensions(framework, semantics_specification)
        accepted_assumptions = sorted(
            [str(x) for x in get_accepted_assumptions(exts, strategy_specification)]
        )

        query = payload.get("query")
        normalized_exts: List[List[str]] = []
        derived_per_ext: List[List[str]] = []
        query_in_ext = []
        for ext in exts:
            ext_set = set(ext)
            derived = forward_closure(ext_set, rule_defs)
            normalized_exts.append(sorted(ext_set))
            derived_per_ext.append(sorted(derived))
            if query:
                query_in_ext.append(bool(str(query) in derived))

        response = {
            "semantics_specification": semantics_specification,
            "strategy_specification": strategy_specification,
            "extensions": normalized_exts,
            "derived": derived_per_ext,
            "accepted_assumptions": accepted_assumptions,
            "count": len(normalized_exts),
        }
        if query:
            response["query"] = str(query)
            response["credulous"] = any(query_in_ext)
            response["skeptical"] = all(query_in_ext) if normalized_exts else False

        print(json.dumps(response, ensure_ascii=False))
        return 0
    except Exception as exc:  # pylint: disable=broad-except
        print(json.dumps({"error": str(exc)}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
