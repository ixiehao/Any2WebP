import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { locales } from "./content.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const output = resolve(process.argv[2] || join(root, "dist/website"));
const site = "https://ixiehao.github.io/Any2WebP/";
const repo = "https://github.com/ixiehao/Any2WebP";
const asset = "Any2WebP-0.2.30-arm64.dmg";
const dmg = repo + "/releases/latest/download/" + asset;
const translations = Object.entries(locales);
const versionedStyles = "style.css?v=2";
const demoFiles = {
  gif: "docs/assets/hummingbird-loop.gif",
  webp: "docs/assets/hummingbird-loop.webp",
};
const demoSizes = Object.fromEntries(await Promise.all(Object.entries(demoFiles).map(async ([ext, file]) =>
  [ext, (await stat(join(root, file))).size])));
const iconSource = await readFile(join(root, "app/index.html"), "utf8");
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const icon = name => {
  const symbol = iconSource.match(new RegExp('<symbol id="' + name + '"[^>]*>([\\s\\S]*?)</symbol>'));
  if (!symbol) throw new Error("Unknown Tabler icon: " + name);
  return '<svg aria-hidden="true" viewBox="0 0 24 24">' + symbol[1] + '</svg>';
};

function head(t, prefix, canonical, extra = "") {
  return [
    "<!doctype html>",
    '<html lang="' + t.lang + '">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    "  <title>" + escape(t.title) + "</title>",
    '  <meta name="description" content="' + escape(t.description) + '">',
    '  <link rel="canonical" href="' + canonical + '">',
    '  <link rel="icon" href="' + prefix + 'assets/icon.png">',
    '  <link rel="stylesheet" href="' + prefix + versionedStyles + '">',
    extra,
    "</head>",
  ].join("\n");
}

function languages(t, prefix) {
  return translations.map(([, target]) =>
    '<a lang="' + target.lang + '" hreflang="' + target.lang + '" href="' + prefix + target.route +
    (target === t ? '" aria-current="page"' : '"') + '>' + target.label + '</a>').join("");
}

function page(key, t) {
  const prefix = t.route ? "../" : "./";
  const screenshot = "assets/workspace-" + key + ".png?v=hummingbird";
  const alternates = translations.map(([, language]) =>
    '  <link rel="alternate" hreflang="' + language.lang + '" href="' + site + language.route + '">');
  const social = [
    '  <link rel="alternate" hreflang="x-default" href="' + site + '">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:title" content="' + escape(t.title) + '">',
    '  <meta property="og:description" content="' + escape(t.description) + '">',
    '  <meta property="og:url" content="' + site + t.route + '">',
    '  <meta property="og:image" content="' + site + screenshot + '">',
  ];
  const featureCards = t.cards.map(([name, title, text]) =>
    '<article class="feature"><div class="feature-icon">' + icon(name) + '</div><h3>' + escape(title) +
    '</h3><p>' + escape(text) + '</p></article>').join("\n");
  const decimal = new Intl.NumberFormat(t.lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const signedDecimal = new Intl.NumberFormat(t.lang, {
    minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  });
  const signedPercent = new Intl.NumberFormat(t.lang, {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  });
  const delta = demoSizes.webp - demoSizes.gif;
  const difference = t.demoDifference(signedDecimal.format(delta / 1024) + " KiB", signedPercent.format(delta / demoSizes.gif));
  const sample = (label, ext) => {
    const assetPath = prefix + "assets/hummingbird-loop." + ext;
    const bytes = demoSizes[ext];
    return '<figure><div class="demo-image"><img src="' + prefix +
      'assets/hummingbird-poster.png" data-motion="' + assetPath +
      '" width="480" height="336" loading="lazy" alt="' + escape(t.demoAlt) + '"></div><figcaption><a href="' +
      assetPath + '">' + label + '</a><span title="' +
      escape(new Intl.NumberFormat(t.lang).format(bytes) + " " + t.demoByteUnit) + '">' +
      escape(decimal.format(bytes / 1024) + " KiB") + '</span></figcaption></figure>';
  };
  const stillRows = t.stillRows.map(([label, type, use]) =>
    '<div class="still-row"><dt>' + label + '</dt><dd><b>' + escape(type) + '</b><span>' + escape(use) + '</span></dd></div>').join("\n");
  const cta = '<a class="button" href="' + dmg + '">' + escape(t.download) + '</a>';

  return head(t, prefix, site + t.route, [...alternates, ...social].join("\n")) + "\n" + [
    "<body>",
    '<a class="skip" href="#main">' + escape(t.skip) + '</a>',
    '<header class="masthead container">',
    '  <a class="brand" href="' + prefix + t.route + '"><img src="' + prefix + 'assets/icon.png" width="34" height="34" alt="">Any2WebP</a>',
    '  <div class="nav"><nav aria-label="' + escape(t.features + " / " + t.formats) + '"><a href="#features">' + escape(t.features) +
    '</a><a href="#formats">' + escape(t.formats) + '</a></nav><nav class="languages" aria-label="' + escape(t.languageMenu) +
    '">' + languages(t, prefix) + '</nav></div>',
    '</header>',
    '<main id="main">',
    '  <section class="hero" aria-labelledby="title"><div class="hero-inner container">',
    '    <div class="hero-copy"><h1 id="title">' + escape(t.heroLead) + '<span>' + escape(t.heroAccent) + '</span></h1>',
    '      <p>' + escape(t.heroDescription) + '</p>',
    '      <div class="actions">' + cta + '<a class="source" href="' + repo + '">' + escape(t.source) + '</a></div>',
    '      <div class="requirements">' + escape(t.requirement) + '</div>',
    '    </div>',
    '    <figure class="hero-image"><img src="' + prefix + screenshot + '" width="2480" height="1550" fetchpriority="high" alt="' + escape(t.screenshotAlt) +
    '"><figcaption>' + escape(t.screenshotCaption) + '</figcaption></figure>',
    '  </div></section>',
    '  <section class="container section" id="features"><h2>' + escape(t.featureHeading) + '</h2><div class="feature-grid">' + featureCards + '</div></section>',
    '  <section class="container section formats" id="formats"><h2>' + escape(t.formatHeading) + '</h2><div class="format-grid">',
    '    <article class="format-card"><h3>' + escape(t.moving) + '</h3><p>' + escape(t.formatDescription) + '</p>',
    '      <div class="sample-pair">' + sample("GIF", "gif") + sample("WebP", "webp") + '</div>',
    '      <p class="demo-note"><strong>' + escape(difference) + '</strong> ' + escape(t.demoNote) + '</p>',
    '      <button class="demo-play" type="button" aria-pressed="false" data-play="' + escape(t.demoPlay) +
    '" data-stop="' + escape(t.demoStop) + '" data-loading="' + escape(t.demoLoading) + '" data-error="' +
    escape(t.demoError) + '" hidden>' + escape(t.demoPlay) + '</button><p class="demo-status" role="status"></p></article>',
    '    <article class="format-card"><h3>' + escape(t.still) + '</h3><dl>' + stillRows + '</dl><a class="small-link" href="https://developers.google.com/speed/webp">' +
    escape(t.formatSource) + '</a></article>',
    '  </div></section>',
    '  <section class="container section"><div class="install"><div><h2>' + escape(t.installHeading) + '</h2>',
    '    <p>' + escape(t.installIntro) + '</p><p class="requirements">' + escape(t.previewNote) + '</p></div>',
    '    <div class="install-actions">' + cta + '<div class="downloads"><a href="' + repo + '/releases/latest">' + escape(t.release) +
    '</a><a href="' + dmg + '.sha256">' + escape(t.checksum) + '</a></div></div>',
    '  </div></section>',
    '</main>',
    '<footer class="container footer"><span>Any2WebP · ' + escape(t.free) + '</span><div><a href="' + repo + '">GitHub</a><a href="' +
    repo + '/issues/new/choose">' + escape(t.support) + '</a></div></footer>',
    '<script type="module" src="' + prefix + 'demo.js?v=2"></script>',
    "</body>",
    "</html>",
  ].join("\n");
}

function downloadPage(t) {
  const prefix = t.route ? "../../" : "../";
  return head(t, prefix, site + t.route,
    '  <meta name="robots" content="noindex">\n  <meta http-equiv="refresh" content="0;url=' + dmg + '">') +
    '\n<body><main class="download-page container"><a class="brand" href="../">Any2WebP</a>' +
    '<h1>' + escape(t.downloadReady) + '</h1><a class="button" href="' + dmg + '">' + escape(t.retry) +
    '</a><p class="requirements">' + escape(t.previewNote) + '</p></main></body></html>\n';
}

const assets = {
  "style.css": "website/style.css",
  "demo.js": "website/demo.js",
  "assets/icon.png": "app/icon.png",
  "assets/hummingbird-poster.png": "website/assets/hummingbird-poster.png",
  "assets/hummingbird-loop.gif": demoFiles.gif,
  "assets/hummingbird-loop.webp": demoFiles.webp,
  "assets/workspace-en.png": "docs/assets/any2webp-en.png",
  "assets/workspace-zh.png": "docs/assets/any2webp-zh-CN.png",
  "assets/workspace-ja.png": "docs/assets/any2webp-ja.png",
  "THIRD-PARTY-NOTICES.txt": "docs/THIRD-PARTY-NOTICES.txt",
  "LICENSE": "LICENSE",
};
await mkdir(join(output, "assets"), { recursive: true });
await Promise.all(Object.entries(assets).map(([destination, source]) =>
  copyFile(join(root, source), join(output, destination))));
for (const [key, t] of translations) {
  await mkdir(join(output, t.route, "download"), { recursive: true });
  await writeFile(join(output, t.route, "index.html"), page(key, t) + "\n");
  await writeFile(join(output, t.route, "download/index.html"), downloadPage(t));
}
const urls = translations.map(([, t]) => "<url><loc>" + site + t.route + "</loc></url>").join("\n");
await writeFile(join(output, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>\n");
await writeFile(join(output, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: " + site + "sitemap.xml\n");
await writeFile(join(output, ".nojekyll"), "");
console.log("Built " + translations.length + " language pages in " + output);
