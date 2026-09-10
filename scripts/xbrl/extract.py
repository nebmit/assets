"""Offline, one-session-per-process Arelle adapter. stdout is never the protocol."""
import json
import sys
import resource
from decimal import Decimal
from datetime import timedelta
from pathlib import Path

PARSER_VERSION = "arelle-2.43.1:1"


def qname(value):
    return f"{{{value.namespaceURI}}}{value.localName}" if value is not None else ""


def extract(request):
    from arelle.api.Session import Session
    from arelle.RuntimeOptions import RuntimeOptions
    from lxml import etree
    from arelle.XmlValidateConst import VALID

    root = Path(request["root"]).resolve()
    urls = request["urls"]
    entries = request["entrypoints"]
    # A local catalog preserves original URLs and relative imports without permitting network access.
    options = RuntimeOptions(entrypointFile=json.dumps([{"ixDocumentSet": entries}]) if len(entries) > 1 else entries[0],
                             internetConnectivity="offline", keepOpen=True, validate=True, calcs="c11r",
                             formulaAction="none", plugins="inlineXbrlDocumentSet|" + str(Path(__file__).resolve().parent / "vendor/edgar/transform"),
                             disablePersistentConfig=True, xdgConfigHome=str(root / "config"), cacheDirectory=str(root / "cache"), logFile="logToBuffer", logFormat="[%(messageCode)s] %(message)s")
    with Session() as session:
        # Install the URL catalog before model loading. URL resolution stays inside the manifest.
        from arelle import WebCache
        original = WebCache.WebCache.getfilename
        def local_file(cache, url, *args, **kwargs):
            canonical = str(url).split("#", 1)[0]
            if canonical in urls:
                return str(root / urls[canonical])
            if canonical.startswith(("http://", "https://")):
                # Validation schemas bundled in the pinned wheel are part of the parser, not network inputs.
                from urllib.parse import urlparse
                import arelle
                parsed = urlparse(canonical)
                bundled = Path(arelle.__file__).parent / "resources" / "cache" / parsed.scheme / parsed.netloc / parsed.path.lstrip("/")
                if bundled.is_file():
                    return str(bundled)
                raise ValueError(f"missing_dependency: {canonical}")
            candidate = Path(cache.normalizeUrl(canonical, kwargs.get("base"))).resolve()
            import arelle
            resources = Path(arelle.__file__).parent.resolve()
            vendor = (Path(__file__).resolve().parent / "vendor").resolve()
            if not candidate.is_relative_to(root) and not candidate.is_relative_to(resources) and not candidate.is_relative_to(vendor):
                raise ValueError(f"unmanifested_local_dependency: {canonical}")
            return original(cache, url, *args, **kwargs)
        WebCache.WebCache.getfilename = local_file
        try:
            session.run(options)
            models = session.get_models()
            if len(models) != 1 or models[0].modelDocument is None:
                raise ValueError("unreadable_document: expected one XBRL model; " + session.get_logs("json"))
            model = models[0]
            artifact = {"schemaVersion": 1, "parserVersion": PARSER_VERSION, "facts": [], "contexts": [], "units": {}, "relationships": [], "diagnostics": []}
            for cid, ctx in sorted(model.contexts.items()):
                dims = [{"axis": qname(axis), "member": qname(dim.memberQname) if dim.isExplicit else None,
                         "typedValue": None if dim.isExplicit else etree.tostring(dim.typedMember, method="c14n").decode("utf-8"), "default": False}
                        for axis, dim in ctx.qnameDims.items()]
                for axis, member in model.qnameDimensionDefaults.items():
                    if axis not in ctx.qnameDims:
                        dims.append({"axis": qname(axis), "member": qname(member), "typedValue": None, "default": True})
                end = ctx.instantDatetime if ctx.isInstantPeriod else ctx.endDatetime
                artifact["contexts"].append({"id": cid, "entity": ctx.entityIdentifier[1], "scheme": ctx.entityIdentifier[0],
                    "start": ctx.startDatetime.date().isoformat() if ctx.isStartEndPeriod else None,
                    "end": (end - timedelta(days=1)).date().isoformat() if end else None,
                    "instant": ctx.isInstantPeriod, "dimensions": sorted(dims, key=lambda d: d["axis"]), "valid": getattr(ctx, "xValid", 0) >= VALID})
            for uid, unit in sorted(model.units.items()):
                artifact["units"][uid] = {"numerator": sorted(qname(q) for q in unit.measures[0]), "denominator": sorted(qname(q) for q in unit.measures[1])}
            for ordinal, fact in enumerate(sorted(model.factsInInstance, key=lambda f: (f.modelDocument.uri, f.objectIndex))):
                numeric = bool(fact.isNumeric)
                val = None if fact.isNil else str(fact.xValue if getattr(fact, "xValid", 0) >= VALID else fact.value)
                if numeric and val is not None and getattr(fact, "xValid", 0) >= VALID:
                    val = format(Decimal(val), "f")
                uri = fact.modelDocument.uri
                document = next((url for url, file in urls.items() if str(root / file) == uri), uri)
                artifact["facts"].append({"id": f"{document}#{fact.id or 'ordinal-' + str(ordinal)}", "concept": qname(fact.qname),
                    "context": fact.contextID, "unit": fact.unitID, "value": val, "nil": fact.isNil, "numeric": numeric,
                    "decimals": fact.decimals, "precision": fact.precision, "valid": getattr(fact, "xValid", 0) >= VALID,
                    "document": document, "line": fact.sourceline})
            for arcrole in sorted({key[0] for key in model.baseSets if key[0] and key[0].startswith("http")}):
                for rel in model.relationshipSet(arcrole).modelRelationships:
                    if hasattr(rel.fromModelObject, "qname") and hasattr(rel.toModelObject, "qname"):
                        artifact["relationships"].append({"arcrole": arcrole, "role": rel.linkrole, "from": qname(rel.fromModelObject.qname),
                            "to": qname(rel.toModelObject.qname), "weight": str(rel.weight) if rel.weight is not None else None})
            logs = json.loads(session.get_logs("json"))
            for entry in logs.get("log", []):
                if entry.get("level", "info").lower() == "info":
                    continue
                artifact["diagnostics"].append({"code": entry.get("code", "unknown"), "severity": entry.get("level", "info"),
                    "message": entry.get("message", {}).get("text", ""), "refs": sorted(__import__("urllib.parse", fromlist=["urljoin"]).urljoin(entries[0], r.get("href", "")) for r in entry.get("refs", []))})
            artifact["diagnostics"].sort(key=lambda d: (d["code"], d["message"], d["refs"]))
            artifact["facts"].sort(key=lambda f: f["id"])
            artifact["relationships"].sort(key=lambda r: (r["arcrole"], r["role"], r["from"], r["to"]))
            if not artifact["facts"]:
                raise ValueError("unreadable_document: no XBRL facts")
            return artifact
        finally:
            WebCache.WebCache.getfilename = original


if __name__ == "__main__":
    resource.setrlimit(resource.RLIMIT_AS, (2 * 1024 ** 3, 2 * 1024 ** 3))
    try:
        request = json.loads(Path(sys.argv[1]).read_text())
        result = extract(request)
        Path(sys.argv[2]).write_text(json.dumps(result, sort_keys=True, separators=(",", ":")))
    except MemoryError:
        print("memory_limit", file=sys.stderr)
        sys.exit(72)
    except Exception as error:
        print(f"extraction_failed: {error}", file=sys.stderr)
        sys.exit(1)
