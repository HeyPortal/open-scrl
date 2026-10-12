# Custom fonts

Select a text layer, then open **Typography → Manage fonts**. On a phone,
select the text and tap **Edit** to find the same controls.

## Import your own font

In **Your fonts**, choose a TTF, OTF, WOFF or WOFF2 file (up to 20 MB), check
its name, weight and style, then choose **Import and use font**. Imports work
offline. Font files are validated before saving; an invalid file does not
change your text or enter the library.

TTF and OTF metadata supplies the initial family name, weight, italic style,
and variable weight range. Compressed WOFF/WOFF2 files start with editable
filename defaults. Set a static weight such as `400`, or the actual variable
range such as `100 900`. Import separate static files individually; the picker
shows each imported face with its weight and style. Use fonts whose licenses
permit your intended use.

## Google Fonts

Open **Google Fonts**, enter a Google Fonts Developer API key, and choose
**Save key and browse**. Search by family name or filter by category. Download
a family to apply it and save all its supplied normal/italic faces locally.
Variable weight ranges are preserved. The catalog uses the
[Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api)
and font files download directly from Google's font host over HTTPS.
Browsing names does not download every font in the catalog.
Downloads are limited to 20 MB per file and 50 MB per family.

The **Google Fonts** tab is grayed out while offline, with the message
“Connect to the internet to browse Google Fonts.” Going offline while browsing
returns to **Your fonts** and cancels pending network work. Imported and
downloaded fonts remain available for editing and export. Reconnecting enables
the catalog again. Catalog metadata is cached for 24 hours to reduce requests.
The app's optional export tools need their first use online to become cached;
see [offline tools](web-updates.md).

### Where to put the API key

For your browser, enter it in **Typography → Manage fonts → Google Fonts**.
The key is stored only in this browser's font settings, separately from project
documents. **API key settings** replaces it; saving an empty value removes the
browser override and uses the deployment default, if one exists.

For a deployment default, copy `.env.example` to `.env.local` in the repository
root and set:

```dotenv
VITE_GOOGLE_FONTS_API_KEY=your_key_here
```

Restart `bun run dev` after changing this file. Production deployments need the
variable at build time and a new build. `.env.local` is ignored by Git.

This is a browser application: deployment keys are visible in its built code,
and visitor-provided keys are accessible to that visitor's browser. Enable the
**Fonts Developer API** in Google Cloud Console, restrict the key to that API,
and set website/HTTP referrer restrictions for your development and production
origins. See Google's
[API key restriction guidance](https://cloud.google.com/docs/authentication/api-keys-best-practices).
Requests send the key in the `X-Goog-Api-Key` header; keys are not added to URLs,
project JSON or application error messages. There is no backend proxy.

## Storage and rendering

The shared font library lives in IndexedDB (`open-scrl-fonts`) on this browser
origin. Families have immutable identifiers derived from font bytes and face
descriptors, so repeated imports deduplicate and fonts with the same name do
not overwrite one another. Project text stores that identifier in the existing
`fontFamily` field; the project schema remains version 2.

The page loads saved fonts before opening project text, and previews, static
export workers and video export load those same bytes before drawing. Font
registration clears cached text measurements. A font missing from local storage
produces an editor warning and blocks export rather than silently substituting
the exported type. Reimport the original file with its original weight/style,
or select another font. Font loading uses the browser's
[CSS Font Loading API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Font_Loading_API).

Fonts stay on this device and origin, as projects and photos do. Clearing site
data removes the library. Font files are not embedded in portable project
packages, and web and native Mac font libraries are independent. Packaging font
files for project transfer would require a future shared document contract.
