"""Sonde temporaire : navigation entre les prélèvements d'un réseau sur Orobnat."""
import re, sys
sys.path.insert(0, "custom_components/orobnat")
import api  # noqa: E402

c = api.OrobnatClient("11")  # Île-de-France
deps = c.departements()
dep = next(v for v, l in deps if v.startswith("075") or "Paris" in l or v == "75")
communes = c.communes(dep)
print("dep", dep, "communes", len(communes), communes[:3])
com = communes[0][0]
res = c.reseaux(dep, com)
print("reseaux", res[:3])
b = c.bulletin(dep, com, res[0][0])
html = c._last_html
print("infos", {k: v for k, v in b.infos.items()})
for pat in [r"posPLV[^<]{0,200}", r"<input[^>]+>", r"<a [^>]*(?:PLV|precedent|suivant|javascript)[^>]*>[^<]{0,80}", r"function \w+\([^)]*\)\s*\{[^}]{0,400}", r"onclick=\"[^\"]{0,200}\""]:
    for m in sorted(set(re.findall(pat, html, re.I)))[:25]:
        print("::", m.replace("\n", " ")[:400])
for m in re.finditer(r"pr[ée]c[ée]dent|suivant", html, re.I):
    print("ctx>>", html[max(0, m.start()-300):m.end()+200].replace("\n", " "))
