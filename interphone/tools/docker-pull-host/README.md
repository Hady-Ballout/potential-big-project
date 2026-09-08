# docker-pull-host — workaround for corrupted image pulls

On this laptop `docker pull` of large images dies with `tls: bad record MAC` (the Wi-Fi link
corrupts long TLS streams inside Docker's VM). This script downloads the image layers on the
Windows host instead, with HTTP range resume and sha256 verification, and writes an OCI tarball
that `docker load` accepts.

```
python pull_oci.py public.ecr.aws supabase/postgres 15.8.1.085 out_dir
docker load -i out_dir/image.tar
```

Registries supported: `public.ecr.aws`, `ghcr.io`, Docker Hub (`registry-1.docker.io`).
Only needed when `npx supabase start` fails to pull an image; run it for the image named in the error.
