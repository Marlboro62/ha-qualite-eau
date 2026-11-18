"""Sonde temporaire : recherche du dernier prélèvement de la commune."""
import sys, time
sys.path.insert(0, "custom_components/orobnat")
import api  # noqa: E402

def run(region, dep_prefix, idx=0):
    c = api.OrobnatClient(region)
    dep = next(v for v, l in c.departements() if v.startswith(dep_prefix))
    com, nom = c.communes(dep)[idx]
    res = c.reseaux(dep, com)[0][0]
    t = time.time()
    b = c.bulletin(dep, com, res, commune_nom=nom, max_bulletins=20, max_age_days=730)
    print(f"== {nom} ({com}) réseau {res} : position={b.position} trouvée={b.commune_trouvee} "
          f"date={b.infos.get('Date du prélèvement')} commune_prélèvement={b.infos.get('Commune de prélèvement')} "
          f"analyses={len(b.analyses)} en {time.time()-t:.1f} s")
    c2 = api.OrobnatClient(region)
    b0 = c2.bulletin(dep, com, res)
    print(f"   sans l'option : date={b0.infos.get('Date du prélèvement')} commune={b0.infos.get('Commune de prélèvement')}")

run("11", "075")
for i in (0, 3, 10):
    run("75", "017", i)
