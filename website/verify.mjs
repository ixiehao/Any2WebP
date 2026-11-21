import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.argv[2] || "dist/website");
const read = file => readFile(resolve(output, file), "utf8");
const site = "https://ixiehao.github.io/Any2WebP/";
const languages = [["en", ""], ["zh-CN", "zh/"], ["ja", "ja/"]];
const pages = ["", "gif-to-webp/", "compress-webp/"];
const expectedUrls = languages.flatMap(([, route]) => pages.map(page => site + route + page));
const titles = new Set();
const descriptions = new Set();

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
      assert.doesNotMatch(html, /<script\b/);
    } else {
      const data = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
      assert.equal(data["@type"], "SoftwareApplication");
      assert.equal(data.url, url);
      assert.equal(data.inLanguage, lang);
      assert.equal(data.offers.price, "0");
      assert.ok(html.includes('href="' + data.downloadUrl + '"'));
      const hrefs = [...html.matchAll(/<h3><a href="([^"]+)"/g)].map(match => new URL(match[1], url).href);
      for (const guide of pages.slice(1)) assert.ok(hrefs.includes(url + guide));
    }
  }
}
console.log("Verified nine indexable pages, reciprocal language links, and non-indexed download redirects.");
