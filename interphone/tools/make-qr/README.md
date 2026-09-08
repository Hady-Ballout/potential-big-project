# make-qr — door sticker QR code

Generates the QR code visitors scan at the door. It encodes `<baseUrl>/d/<building-slug>`,
which opens the visitor page of the web app.

```
cd tools/make-qr
npm install
node index.mjs <building-slug> <baseUrl> [--out <file-without-extension>]

node index.mjs demo-building http://192.168.1.10:5173          # local demo, phone on the same Wi-Fi
node index.mjs demo-building https://interphone.example --out stickers/front-door
```

Writes `<out>.png` (1024 px, for printing) and `<out>.svg` (scalable). Default output is `./<slug>.png` and `.svg`.
The slug must match the `buildings.slug` rule (`a-z`, `0-9`, `-`, 3 to 40 chars).

The sticker artwork (building name, "scan to ring" text, logo) is not generated yet; drop the PNG into any label template.
