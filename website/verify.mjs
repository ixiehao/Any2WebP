import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { guideScreens, guideScreenshotPath, guideScreenshotSize } from "./guide-screens.mjs";

const output = resolve(process.argv[2] || "dist/website");
const read = file => readFile(resolve(output, file), "utf8");
const site = "https://ixiehao.github.io/Any2WebP/";
const languages = [["en", ""], ["zh-CN", "zh/"], ["ja", "ja/"]];
const guides = {
  "gif-to-webp/": "compress-webp/",
  "compress-webp/": "gif-to-webp/",
  "video-to-webp-gif/": "images-to-webp-gif/",
  "images-to-webp-gif/": "video-to-webp-gif/",
};
const pages = ["", ...Object.keys(guides)];
const expectedUrls = languages.flatMap(([, route]) => pages.map(page => site + route + page));
const titles = new Set();
const descriptions = new Set();
const windowsDownloads = new Set();

const wasm = await readFile(resolve(output, "online-converter.wasm"));
assert.equal(wasm.subarray(0, 8).toString("hex"), "0061736d01000000");
assert.match(await read("ONLINE-CONVERTER-NOTICES.txt"), /image-webp/);

const sitemap = await read("sitemap.xml");
assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort(), expectedUrls.sort());

for (const [lang, route] of languages) {
  const download = await read(route + "download/index.html");
  assert.match(download, /<meta name="robots" content="noindex">/);
  assert.match(download, /http-equiv="refresh" content="0;url=https:\/\/github.com\/ixiehao\/Any2WebP\/releases\/latest\/download\//);

  for (const page of pages) {
    const path = route + page;
    const html = await read(path + "index.html");
    const url = site + path;
    const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
    const description = html.match(/<meta name="description" content="([^"]+)">/)?.[1];
    assert.ok(title && !titles.has(title), url + " must have a unique title");
    assert.ok(description && !descriptions.has(description), url + " must have a unique description");
    titles.add(title);
    descriptions.add(description);
    assert.ok(html.includes('<html lang="' + lang + '">'));
    assert.ok(html.includes('<link rel="canonical" href="' + url + '">'));
    assert.ok(html.includes('<meta property="og:url" content="' + url + '">'));
    assert.doesNotMatch(html, /<meta name="robots" content="noindex">/);
    assert.equal([...html.matchAll(/<h1[ >]/g)].length, 1);
    assert.ok(html.includes('<link rel="alternate" hreflang="x-default" href="' + site + page + '">'));
    for (const [targetLang, targetRoute] of languages) {
      const target = site + targetRoute + page;
      assert.ok(html.includes('<link rel="alternate" hreflang="' + targetLang + '" href="' + target + '">'));
      const visible = html.match(new RegExp('<a lang="' + targetLang + '" hreflang="' + targetLang + '" href="([^"]+)"'));
      assert.equal(new URL(visible[1], url).href, target);
    }

    if (page) {
      assert.equal([...html.matchAll(/<ol>[\s\S]*?<\/ol>/g)].length, 1);
      assert.ok(html.includes('href="../#formats"'));
      assert.ok(html.includes('href="../' + guides[page] + '"'));
      assert.doesNotMatch(html, /<script\b/);
      const locale = route.slice(0, -1) || "en";
      const shots = guideScreens[page.slice(0, -1)];
      const images = [...html.matchAll(/<figure class="guide-shot"><a href="([^"]+)"><img src="([^"]+)"[^>]* alt="([^"]+)"><\/a><figcaption>([^<]+)<\/figcaption><\/figure>/g)];
      assert.equal(images.length, shots.length);
      for (const [index, [, link, src]] of images.entries()) {
        const path = guideScreenshotPath(shots[index].id, locale);
        assert.equal(new URL(link, url).href, site + path);
        assert.equal(link, src);
        const asset = await readFile(resolve(output, path));
        assert.equal(asset.toString("ascii", 8, 12), "WEBP");
      }
      assert.ok(html.includes('width="' + guideScreenshotSize.width + '" height="' + guideScreenshotSize.height + '"'));
    } else {
      const hero = html.match(/<section class="hero"[^>]*>([\s\S]*?)<\/section>/)?.[1];
      const online = html.match(/<section class="container section online-converter" id="online"[^>]*>([\s\S]*?)<\/section>/)?.[1];
      assert.ok(hero?.includes('href="#online"'));
      assert.ok(!hero.includes('type="file"'));
      const windowsAsset = hero.match(/href="(https:\/\/github\.com\/ixiehao\/Any2WebP\/releases\/download\/v([0-9]+\.[0-9]+\.[0-9]+)-preview\/Any2WebP-\2-windows-preview_x64-setup\.exe)"/);
      assert.ok(windowsAsset, url + " links to the Windows x64 preview installer");
      const [, windowsExe, windowsVersion] = windowsAsset;
      windowsDownloads.add(windowsExe);
      const windowsDetails = html.match(/<article class="install" id="windows-preview">([\s\S]*?)<\/article>/)?.[1];
      assert.ok(windowsDetails?.includes('href="' + windowsExe + '"'));
      assert.ok(windowsDetails.includes('href="' + windowsExe + '.sha256"'));
      assert.ok(windowsDetails.includes('href="https://github.com/ixiehao/Any2WebP/releases/tag/v' + windowsVersion + '-preview"'));
      assert.ok(windowsDetails.includes("Windows 10 22H2") && windowsDetails.includes("Windows 11 21H2"));
      assert.ok(html.indexOf('id="features"') < html.indexOf('id="online"'));
      assert.match(online ?? "", /<p id="online-scope">[^<]+<\/p>/);
      assert.match(online, /aria-describedby="online-scope online-help"/);
      assert.match(html, /<script type="module" src="[^"]*online\.js\?v=1">/);
      const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
      assert.equal(data["@type"], "SoftwareApplication");
      assert.equal(data.url, url);
      assert.equal(data.inLanguage, lang);
      assert.equal(data.offers.price, "0");
      assert.ok(hero.includes('<a class="button" href="' + data.downloadUrl + '"'));
      assert.ok(online.includes('href="' + data.downloadUrl + '"'));
      const hrefs = [...html.matchAll(/<h3><a href="([^"]+)"/g)].map(match => new URL(match[1], url).href);
      for (const guide of pages.slice(1)) assert.ok(hrefs.includes(url + guide));
    }
  }
}
assert.equal(windowsDownloads.size, 1, "all languages link to the same Windows installer");
console.log("Verified " + expectedUrls.length + " indexable pages, reciprocal language links, and Mac and Windows download links.");
