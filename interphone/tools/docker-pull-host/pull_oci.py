"""Host-side, resumable, checksum-verified image download -> OCI layout tar for `docker load`.

Usage: python pull_oci.py public.ecr.aws supabase/postgres 15.8.1.085 out_dir
Produces out_dir/image.tar (OCI image layout + docker-archive manifest.json for the classic store).
"""
import hashlib, json, os, sys, tarfile, time, urllib.request, urllib.error

registry, repo, tag, out_dir = sys.argv[1:5]
os.makedirs(out_dir, exist_ok=True)
blobs_dir = os.path.join(out_dir, "blobs", "sha256")
os.makedirs(blobs_dir, exist_ok=True)

def token():
    if registry == "public.ecr.aws":
        u = f"https://public.ecr.aws/token/?service=public.ecr.aws&scope=repository:{repo}:pull"
    elif registry == "ghcr.io":
        u = f"https://ghcr.io/token?scope=repository:{repo}:pull"
    else:
        u = f"https://auth.docker.io/token?service=registry.docker.io&scope=repository:{repo}:pull"
    with urllib.request.urlopen(u, timeout=60) as r:
        return json.load(r)["token"]

TOK = token()
ACCEPT = ", ".join([
    "application/vnd.docker.distribution.manifest.v2+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
    "application/vnd.oci.image.manifest.v1+json",
    "application/vnd.oci.image.index.v1+json",
])

def get(path, headers=None, raw=False):
    req = urllib.request.Request(f"https://{registry}/v2/{repo}/{path}", headers={"Authorization": f"Bearer {TOK}", "Accept": ACCEPT, **(headers or {})})
    return urllib.request.urlopen(req, timeout=120)

def fetch_json(path):
    with get(path) as r:
        return json.load(r), r.headers.get("Content-Type", "")

def download_blob(digest, size):
    hexd = digest.split(":", 1)[1]
    dest = os.path.join(blobs_dir, hexd)
    if os.path.exists(dest) and os.path.getsize(dest) == size:
        h = hashlib.sha256()
        with open(dest, "rb") as f:
            for chunk in iter(lambda: f.read(1 << 20), b""):
                h.update(chunk)
        if h.hexdigest() == hexd:
            print(f"  ok (cached) {hexd[:12]} {size/1e6:.1f} MB", flush=True)
            return
        os.remove(dest)
    part = dest + ".part"
    attempt = 0
    while True:
        attempt += 1
        have = os.path.getsize(part) if os.path.exists(part) else 0
        try:
            hdr = {"Range": f"bytes={have}-"} if have else {}
            with get(f"blobs/{digest}", hdr) as r, open(part, "ab") as f:
                if have and r.status != 206:
                    f.seek(0); f.truncate(); have = 0
                t0 = time.time(); got = 0
                for chunk in iter(lambda: r.read(1 << 20), b""):
                    f.write(chunk); got += len(chunk)
                    if time.time() - t0 > 10:
                        print(f"    {hexd[:12]} {(have+got)/1e6:.0f}/{size/1e6:.0f} MB", flush=True); t0 = time.time()
            if os.path.getsize(part) < size:
                raise IOError("short read")
            break
        except Exception as e:  # network hiccup: resume
            print(f"    retry {attempt} for {hexd[:12]} after error: {e}", flush=True)
            if attempt > 30:
                raise
            time.sleep(min(30, 2 * attempt))
    h = hashlib.sha256()
    with open(part, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    if h.hexdigest() != hexd:
        print(f"    CHECKSUM MISMATCH {hexd[:12]}, redownloading", flush=True)
        os.remove(part)
        return download_blob(digest, size)
    os.replace(part, dest)
    print(f"  ok {hexd[:12]} {size/1e6:.1f} MB", flush=True)

manifest_ref = tag
m, ctype = fetch_json(f"manifests/{tag}")
if "manifests" in m:  # multi-arch index: pick linux/amd64
    entry = next(x for x in m["manifests"] if x["platform"].get("os") == "linux" and x["platform"].get("architecture") == "amd64")
    print(f"index -> amd64 manifest {entry['digest'][:19]}")
    manifest_ref = entry["digest"]
# Fetch raw bytes so the digest matches exactly what the registry serves.
with get(f"manifests/{manifest_ref}") as r:
    manifest_bytes = r.read()
    ctype = r.headers.get("Content-Type", ctype)
m = json.loads(manifest_bytes)
manifest_digest = "sha256:" + hashlib.sha256(manifest_bytes).hexdigest()
with open(os.path.join(blobs_dir, manifest_digest[7:]), "wb") as f:
    f.write(manifest_bytes)

cfg = m["config"]; layers = m["layers"]
total = cfg["size"] + sum(l["size"] for l in layers)
print(f"config + {len(layers)} layers, {total/1e6:.0f} MB total")
download_blob(cfg["digest"], cfg["size"])
for l in layers:
    download_blob(l["digest"], l["size"])

ref = f"{registry}/{repo}:{tag}"
index = {"schemaVersion": 2, "mediaType": "application/vnd.oci.image.index.v1+json",
         "manifests": [{"mediaType": ctype or m.get("mediaType"), "digest": manifest_digest, "size": len(manifest_bytes),
                        "annotations": {"org.opencontainers.image.ref.name": ref, "io.containerd.image.name": ref}}]}
with open(os.path.join(out_dir, "index.json"), "w") as f: json.dump(index, f)
with open(os.path.join(out_dir, "oci-layout"), "w") as f: json.dump({"imageLayoutVersion": "1.0.0"}, f)
# docker-archive manifest for the classic graph driver store
with open(os.path.join(out_dir, "manifest.json"), "w") as f:
    json.dump([{"Config": f"blobs/sha256/{cfg['digest'][7:]}", "RepoTags": [ref],
                "Layers": [f"blobs/sha256/{l['digest'][7:]}" for l in layers]}], f)

tar_path = os.path.join(out_dir, "image.tar")
print("writing", tar_path, flush=True)
with tarfile.open(tar_path, "w") as t:
    for name in ("oci-layout", "index.json", "manifest.json"):
        t.add(os.path.join(out_dir, name), arcname=name)
    for fn in os.listdir(blobs_dir):
        if not fn.endswith(".part"):
            t.add(os.path.join(blobs_dir, fn), arcname=f"blobs/sha256/{fn}")
print("done", flush=True)
