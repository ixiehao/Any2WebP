import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { locales } from "./content.mjs";
import { guides } from "./guides.mjs";
import { bytesPerKB, sizeText } from "../app/byte-size.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const output = resolve(process.argv[2] || join(root, "dist/website"));
const site = "https://ixiehao.github.io/Any2WebP/";
const repo = "https://github.com/ixiehao/Any2WebP";
const asset = "Any2WebP-0.2.30-arm64.dmg";
const dmg = repo + "/releases/latest/download/" + asset;
const translations = Object.entries(locales);
const guideEntries = Object.entries(guides);
const pageUrl = (t, leaf = "") => site + t.route + leaf;
const pathPrefix = (t, leaf = "") => "../".repeat(Number(Boolean(t.route)) + Number(Boolean(leaf))) || "./";
const workspaceImage = key => "assets/workspace-" + key + ".png?v=hummingbird-kb";
const versionedStyles = "style.css?v=5";
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

function masthead(t, prefix, leaf = "") {
  const home = prefix + t.route;
  const links = [["features", t.features], ["formats", t.formats], ["guides", t.guidesHeading]];
  const sections = links.map(([id, label]) =>
    '<a href="' + (leaf ? home : "") + '#' + id + '">' + escape(label) + '</a>').join("");
  const languages = translations.map(([, target]) =>
    '<a lang="' + target.lang + '" hreflang="' + target.lang + '" href="' + prefix + target.route + leaf +
    (target === t ? '" aria-current="page"' : '"') + '>' + target.label + '</a>').join("");
  return '<header class="masthead container"><a class="brand" href="' + home +
    '"><img src="' + prefix + 'assets/icon.png" width="34" height="34" alt="">Any2WebP</a>' +
    '<div class="nav"><nav aria-label="' + escape(t.features + " / " + t.formats) + '">' + sections +
    '</nav><nav class="languages" aria-label="' + escape(t.languageMenu) +
    '">' + languages + '</nav></div></header>';
}

function footer(t) {
  return '<footer class="container footer"><span>Any2WebP · ' + escape(t.free) +
    '</span><div><a href="' + repo + '">GitHub</a><a href="' + repo + '/issues/new/choose">' +
    escape(t.support) + '</a></div></footer>';
}

function publicHead(key, t, copy, leaf = "", structuredData = "") {
  const url = pageUrl(t, leaf);
  const image = site + workspaceImage(key);
  const alternates = translations.map(([, target]) =>
    '  <link rel="alternate" hreflang="' + target.lang + '" href="' + pageUrl(target, leaf) + '">');
  return head({ ...copy, lang: t.lang }, pathPrefix(t, leaf), url, [
    ...alternates,
    '  <link rel="alternate" hreflang="x-default" href="' + site + leaf + '">',
    '  <meta property="og:type" content="website">',
    '  <meta property="og:site_name" content="Any2WebP">',
    '  <meta property="og:locale" content="' + t.socialLocale + '">',
    '  <meta property="og:title" content="' + escape(copy.title) + '">',
    '  <meta property="og:description" content="' + escape(copy.description) + '">',
    '  <meta property="og:url" content="' + url + '">',
    '  <meta property="og:image" content="' + image + '">',
    '  <meta property="og:image:alt" content="' + escape(t.screenshotAlt) + '">',
    '  <meta name="twitter:card" content="summary_large_image">',
    structuredData,
  ].filter(Boolean).join("\n"));
}

function softwareMetadata(key, t) {
  const data = {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Any2WebP",
    url: pageUrl(t),
    inLanguage: t.lang,
    description: t.heroDescription,
    applicationCategory: "MultimediaApplication",
    operatingSystem: "macOS 26.0+",
    processorRequirements: "Apple Silicon",
    downloadUrl: dmg,
    screenshot: site + workspaceImage(key),
    license: repo + "/blob/main/LICENSE",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD", url: dmg },
    featureList: t.cards.map(([, title]) => title),
  };
  return '  <script type="application/ld+json">' + JSON.stringify(data).replaceAll("<", "\\u003c") + '</script>';
}

function downloadButton(t) {
  return '<a class="button" href="' + dmg + '">' + escape(t.download) + '</a>';
}

function onlineConverter(t) {
  const messages = escape(JSON.stringify(t.online));
  return '      <section class="online-converter" id="online" aria-labelledby="online-title" data-messages="' + messages + '">' +
    '<h2 id="online-title">' + escape(t.online.title) + '</h2><p>' + escape(t.online.help) + '</p>' +
    '<div class="online-actions"><button class="button online-pick" type="button" disabled>' + escape(t.online.pick) + '</button>' +
    '<input type="file" accept="image/jpeg,image/png,image/gif,.jpg,.jpeg,.png,.gif" hidden>' +
    '<a class="online-download" hidden download>' + escape(t.online.download) + '</a></div>' +
    '<p class="online-status" role="status"></p><noscript><p>' + escape(t.online.unavailable) + '</p></noscript></section>';
}

function page(key, t) {
  const prefix = pathPrefix(t);
  const screenshot = workspaceImage(key);
  const featureCards = t.cards.map(([name, title, text]) =>
    '<article class="feature"><div class="feature-icon">' + icon(name) + '</div><h3>' + escape(title) +
    '</h3><p>' + escape(text) + '</p></article>').join("\n");
  const signedDecimal = new Intl.NumberFormat(t.lang, {
    minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  });
  const signedPercent = new Intl.NumberFormat(t.lang, {
    style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero",
  });
  const delta = demoSizes.webp - demoSizes.gif;
  const difference = t.demoDifference(signedDecimal.format(delta / bytesPerKB) + " KB", signedPercent.format(delta / demoSizes.gif));
  const sample = (label, ext) => {
    const assetPath = prefix + "assets/hummingbird-loop." + ext;
    const bytes = demoSizes[ext];
    return '<figure><div class="demo-image" role="img" aria-label="' + escape(t.demoAlt) + '"><img src="' + prefix +
      'assets/hummingbird-poster.png" width="480" height="336" loading="lazy" alt="">' +
      '<canvas width="480" height="336" aria-hidden="true" hidden></canvas></div><figcaption><a href="' +
      assetPath + '">' + label + '</a><span title="' +
      escape(new Intl.NumberFormat(t.lang).format(bytes) + " " + t.demoByteUnit) + '">' +
      escape(sizeText(bytes)) + '</span></figcaption></figure>';
  };
  const stillRows = t.stillRows.map(([label, type, use]) =>
    '<div class="still-row"><dt>' + label + '</dt><dd><b>' + escape(type) + '</b><span>' + escape(use) + '</span></dd></div>').join("\n");
  const cta = downloadButton(t);
  const guideCards = guideEntries.map(([slug, guide]) =>
    '<article class="feature"><h3><a href="' + slug + '/">' + escape(guide[key].title) +
    '</a></h3><p>' + escape(guide[key].description) + '</p></article>').join("\n");

  return publicHead(key, t, t, "", softwareMetadata(key, t)) + "\n" + [
    "<body>",
    '<a class="skip" href="#main">' + escape(t.skip) + '</a>',
    masthead(t, prefix),
    '<main id="main">',
    '  <section class="hero" aria-labelledby="title"><div class="hero-inner container">',
    '    <div class="hero-copy"><h1 id="title">' + escape(t.heroLead) + ' <span>' + escape(t.heroAccent) + '</span></h1>',
    '      <p>' + escape(t.heroDescription) + '</p>',
    onlineConverter(t),
    '      <div class="actions">' + cta + '<a class="source" href="' + repo + '">' + escape(t.source) + '</a></div>',
    '      <div class="requirements">' + escape(t.requirement) + '</div>',
    '    </div>',
    '    <figure class="hero-image"><img src="' + prefix + screenshot + '" width="2480" height="1550" fetchpriority="high" alt="' + escape(t.screenshotAlt) +
    '"><figcaption>' + escape(t.screenshotCaption) + '</figcaption></figure>',
    '  </div></section>',
    '  <section class="container section" id="features"><h2>' + escape(t.featureHeading) + '</h2><div class="feature-grid">' + featureCards + '</div></section>',
    '  <section class="container section formats" id="formats"><h2>' + escape(t.formatHeading) + '</h2><div class="format-grid">',
    '    <article class="format-card"><h3>' + escape(t.moving) + '</h3><p>' + escape(t.formatDescription) + '</p>',
    '      <div class="sample-pair" data-frames="' + prefix + 'assets/hummingbird-frames.webp">' + sample("GIF", "gif") + sample("WebP", "webp") + '</div>',
    '      <p class="demo-note"><strong>' + escape(difference) + '</strong> ' + escape(t.demoNote) + '</p>',
    '      <button class="demo-play" type="button" data-play="' + escape(t.demoPlay) +
    '" data-pause="' + escape(t.demoPause) + '" data-resume="' + escape(t.demoResume) +
    '" data-loading="' + escape(t.demoLoading) + '" data-error="' + escape(t.demoError) +
    '" hidden>' + escape(t.demoPlay) + '</button><p class="demo-status" role="status"></p></article>',
    '    <article class="format-card"><h3>' + escape(t.still) + '</h3><dl>' + stillRows + '</dl><a class="small-link" href="https://developers.google.com/speed/webp">' +
    escape(t.formatSource) + '</a></article>',
    '  </div></section>',
    '  <section class="container section" id="guides"><h2>' + escape(t.guidesHeading) + '</h2><div class="guide-links">' + guideCards + '</div></section>',
    '  <section class="container section"><div class="install"><div><h2>' + escape(t.installHeading) + '</h2>',
    '    <p>' + escape(t.installIntro) + '</p><p class="requirements">' + escape(t.previewNote) + '</p></div>',
    '    <div class="install-actions">' + cta + '<div class="downloads"><a href="' + repo + '/releases/latest">' + escape(t.release) +
    '</a><a href="' + dmg + '.sha256">' + escape(t.checksum) + '</a></div></div>',
    '  </div></section>',
    '</main>',
    footer(t),
    '<script type="module" src="' + prefix + 'demo.js?v=3"></script>',
    '<script type="module" src="' + prefix + 'online.js?v=1"></script>',
    "</body>",
    "</html>",
  ].join("\n");
}

function guidePage(key, t, slug, guide) {
  const leaf = slug + "/";
  const prefix = pathPrefix(t, leaf);
  const steps = guide.steps.map(step => '<li>' + escape(step) + '</li>').join("\n");
  const related = guideEntries.find(([other]) => other !== slug);
  return publicHead(key, t, { ...guide, title: guide.title + " | Any2WebP" }, leaf) + "\n" + [
    "<body>",
    '<a class="skip" href="#main">' + escape(t.skip) + '</a>',
    masthead(t, prefix, leaf),
    '<main class="container guide" id="main">',
    '  <article>',
    '    <h1>' + escape(guide.title) + '</h1>',
    '    <p class="guide-intro">' + escape(guide.description) + '</p>',
    '    <div class="actions">' + downloadButton(t) + '</div>',
    '    <p class="requirements">' + escape(t.requirement) + '</p>',
    '    <h2>' + escape(t.stepsHeading) + '</h2><ol>' + steps + '</ol>',
    '    <h2>' + escape(guide.detailHeading) + '</h2><p>' + escape(guide.detail) + '</p>',
    '    <ul class="guide-related"><li><a href="../#formats">' + escape(t.comparison) + '</a></li>' +
    '<li><a href="../' + related[0] + '/">' + escape(related[1][key].title) + '</a></li></ul>',
    '  </article>',
    '</main>',
    footer(t),
    '</body>',
    '</html>',
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
  "online.js": "website/online.js",
  "online-worker.js": "website/online-worker.js",
  "byte-size.js": "app/byte-size.js",
  "online-converter.wasm": "website/converter/target/wasm32-unknown-unknown/release/any2webp_online.wasm",
  "ONLINE-CONVERTER-NOTICES.txt": "website/converter/target/ONLINE-CONVERTER-NOTICES.txt",
  "assets/icon.png": "app/icon.png",
  "assets/hummingbird-poster.png": "website/assets/hummingbird-poster.png",
  "assets/hummingbird-frames.webp": "website/assets/hummingbird-frames.webp",
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
  for (const [slug, guide] of guideEntries) {
    const path = join(output, t.route, slug);
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "index.html"), guidePage(key, t, slug, guide[key]) + "\n");
  }
}
const indexedLeaves = ["", ...guideEntries.map(([slug]) => slug + "/")];
const urls = translations.flatMap(([, t]) => indexedLeaves.map(leaf =>
  "<url><loc>" + pageUrl(t, leaf) + "</loc></url>")).join("\n");
await writeFile(join(output, "sitemap.xml"), '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "\n</urlset>\n");
await writeFile(join(output, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: " + site + "sitemap.xml\n");
await writeFile(join(output, ".nojekyll"), "");
console.log("Built " + translations.length + " language pages in " + output);
