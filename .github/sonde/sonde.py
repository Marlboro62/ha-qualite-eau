"""Sonde temporaire : bulletins précédents (posPLV) sur Orobnat."""
import sys
sys.path.insert(0, "custom_components/orobnat")
import api  # noqa: E402

def run(region, dep_pick, n=4, extra=(30, 400)):
    c = api.OrobnatClient(region)
    deps = c.departements()
    dep = next(v for v, l in deps if dep_pick(v, l))
    com = c.communes(dep)[0][0]
    res = c.reseaux(dep, com)[0][0]
    b = c.bulletin(dep, com, res)
    print("==", region, dep, com, res, "| pos 0:", b.infos.get("Date du prélèvement"), b.infos.get("Commune de prélèvement"))
    for pos in list(range(1, n)) + list(extra):
        c._post("rechercher", departement=dep, communeDepartement=com, reseau=res, posPLV=str(pos))
        bb = api.parse_bulletin(c._last_html)
        print(f"   pos {pos}: date={bb.infos.get('Date du prélèvement')} commune={bb.infos.get('Commune de prélèvement')} analyses={len(bb.analyses)} posPLV_renvoye={c._page and [v for v in [c._form.get('posPLV')]]}")
        import re
        m = re.search(r'name="posPLV" value="(\d*)"', c._last_html)
        print("      posPLV dans la page:", m.group(1) if m else None)

run("11", lambda v, l: v.startswith("075"))
run("75", lambda v, l: v.startswith("017"), n=6)
