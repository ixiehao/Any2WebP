"""Media regressions with generated source pixels and independent RIFF parsing."""
import json
from pathlib import Path
import random
import struct
import subprocess
import tempfile
import unittest
import zlib

ROOT = Path(__file__).resolve().parents[1]
TRIPLE = {
    "arm64": "aarch64-apple-darwin",
    "x86_64": "x86_64-apple-darwin",
}[subprocess.check_output(["uname", "-m"], text=True).strip()]
CODEC = ROOT / "src-tauri" / "binaries" / ("any2webp-codec-" + TRIPLE)
PALETTE = bytes([0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255])
CLEAR, RED, GREEN, BLUE = (b"\0\0\0\0", b"\xff\0\0\xff", b"\0\xff\0\xff", b"\0\0\xff\xff")


def gif_bytes(repeats):
    header = b"GIF89a" + struct.pack("<HHBBB", 4, 3, 0x81, 0, 0) + PALETTE
    if repeats is not None:
        header += b"\x21\xff\x0bNETSCAPE2.0\x03\x01" + struct.pack("<H", repeats) + b"\0"
    parts = [header]
    for x, y, width, height, dispose, delay, indices in [
        (0, 0, 4, 3, 1, 1, [1] + [0] * 11),
        (1, 0, 1, 1, 3, 3, [2]),
        (2, 1, 1, 1, 2, 0, [3]),
        (3, 2, 1, 1, 1, 17, [2]),
        (3, 2, 1, 1, 1, 1, [0]),
    ]:
        control = b"\x21\xf9\x04" + struct.pack("<BHB", (dispose << 2) | 1, delay, 0) + b"\0"
        descriptor = b"\x2c" + struct.pack("<HHHHB", x, y, width, height, 0)
        # Clear before each literal so all LZW codes stay three bits wide.
        codes = [code for color in indices for code in (4, color)] + [5]
        bits = sum(code << (i * 3) for i, code in enumerate(codes))
        compressed = bits.to_bytes((len(codes) * 3 + 7) // 8, "little")
        parts.append(control + descriptor + bytes([2, len(compressed)]) + compressed + b"\0")
    return b"".join(parts) + b"\x3b"


def riff_metadata(path):
    data = path.read_bytes()
    assert data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    assert struct.unpack_from("<I", data, 4)[0] == len(data) - 8
    delays = []
    plays = None
    offset = 12
    while offset < len(data):
        kind, size = struct.unpack_from("<4sI", data, offset)
        payload = offset + 8
        if kind == b"ANIM":
            plays = struct.unpack_from("<H", data, payload + 4)[0]
        if kind == b"ANMF":
            delays.append(int.from_bytes(data[payload + 12:payload + 15], "little"))
        offset = payload + size + (size & 1)
    assert offset == len(data)
    return plays, delays


def png_chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))


def png_header(width, height):
    return b"\x89PNG\r\n\x1a\n" + png_chunk(
        b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    )


def png_rows(width, pixels):
    rows = [b"\0" + pixels[i:i+4*width] for i in range(0, len(pixels), 4*width)]
    return zlib.compress(b"".join(rows))


def png(path, width, height, pixels):
    path.write_bytes(png_header(width, height)
        + png_chunk(b"IDAT", png_rows(width, pixels)) + png_chunk(b"IEND", b""))


def apng(path, plays=3):
    def control(sequence, width, height, x, y, delay, dispose):
        return png_chunk(b"fcTL", struct.pack(
            ">IIIIIHHBB", sequence, width, height, x, y, delay, 1000, dispose, 0
        ))

    partial = bytes([0, 255, 0, 128])
    first = RED + CLEAR * 11
    path.write_bytes(png_header(4, 3)
        + png_chunk(b"acTL", struct.pack(">II", 3, plays))
        + control(0, 4, 3, 0, 0, 17, 0) + png_chunk(b"IDAT", png_rows(4, first))
        + control(1, 1, 1, 1, 0, 83, 2)
        + png_chunk(b"fdAT", struct.pack(">I", 2) + png_rows(1, partial))
        + control(3, 1, 1, 3, 2, 123, 0)
        + png_chunk(b"fdAT", struct.pack(">I", 4) + png_rows(1, BLUE))
        + png_chunk(b"IEND", b""))
    return [first, RED + partial + CLEAR * 10, RED + CLEAR * 10 + BLUE]


def frame_edit(path, width, height, plays, frames):
    groups = {}
    for slot, (source, index, delay) in enumerate(frames):
        groups.setdefault(source, []).append((slot, index, delay))
    body = b"A2F1" + struct.pack("<5I", width, height, plays, len(frames), len(groups))
    for source, selected in groups.items():
        raw_path = str(source).encode()
        body += struct.pack("<I", len(raw_path)) + raw_path + struct.pack("<I", len(selected))
        body += b"".join(struct.pack("<3I", *entry) for entry in selected)
    path.write_bytes(body)


class CodecTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory(prefix="any2webp-tests-")
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name)

    def codec(self, *args, check=True):
        return subprocess.run([CODEC, *map(str, args)], check=check, capture_output=True)

    def convert(self, source, result, target=0, *, strengths=None, format="webp"):
        adjustment = ("--adjust", *strengths) if strengths is not None else ()
        operation = "convert-gif" if format == "gif" else "convert"
        return json.loads(self.codec(operation, source, result, target, *adjustment).stdout)

    def preview(self, path, *, strengths=None):
        adjustment = ("--adjust", *strengths) if strengths is not None else ()
        raw = self.codec("preview", path, *adjustment).stdout
        width, height, count, *_ = struct.unpack_from("<10I", raw)
        pixels = raw[4 * (10 + count):]
        size = width * height * 4
        self.assertEqual(len(pixels), count * size)
        return [pixels[i:i+size] for i in range(0, len(pixels), size)]

    def test_exports_gif_with_rounded_delays_binary_alpha_and_loop(self):
        source = self.path / "motion.png"
        expected = [frame.replace(b"\0\xff\0\x80", GREEN) for frame in apng(source, plays=200000)]
        webp = self.path / "motion.webp"
        self.convert(source, webp)
        for input_path, loop_count in [(source, 65536), (webp, 65535)]:
            result = self.path / "motion.gif"
            stats = self.convert(input_path, result, format="gif")
            data = result.read_bytes()
            self.assertEqual(data[:6], b"GIF89a")
            self.assertEqual(data[-1:], b"\x3b")
            self.assertIn(b"NETSCAPE2.0\x03\x01" + struct.pack("<H", loop_count - 1) + b"\0", data)
            self.assertEqual(stats["output"]["plays"], loop_count)
            self.assertEqual(stats["output"]["delays"], [20, 80, 120])
            self.assertEqual(self.preview(result), expected)

    def test_frame_edit_reorders_existing_frames_and_fits_inserted_images(self):
        source = self.path / "animation.gif"
        source.write_bytes(gif_bytes(2))
        original = self.preview(source)
        still = self.path / "portrait.png"
        png(still, 1, 3, BLUE * 3)
        manifest = self.path / "edit"
        frame_edit(manifest, 4, 3, 3, [
            (source, 4, 100), (still, 0, 500), (source, 0, 83), (source, 4, 50),
        ])
        packet = self.codec("preview-frames", manifest).stdout
        self.assertEqual(struct.unpack_from("<10I", packet)[:4], (4, 3, 4, 3))
        self.assertEqual(struct.unpack_from("<4I", packet, 40), (100, 500, 83, 50))
        expected = [original[4], (CLEAR + BLUE + CLEAR + CLEAR) * 3, original[0], original[4]]
        self.assertEqual(packet[56:], b"".join(expected))
        for op, suffix, delays in [
            ("convert-frames", "webp", [100, 500, 83, 50]),
            ("convert-frames-gif", "gif", [100, 500, 80, 50]),
        ]:
            result = self.path / ("edited." + suffix)
            stats = json.loads(self.codec(op, manifest, result, 1024).stdout)
            self.assertEqual(stats["output"]["delays"], delays)
            self.assertEqual(stats["output"]["plays"], 3)
            self.assertTrue(stats["output"]["alpha"])
            self.assertEqual(self.preview(result), expected)

    def test_gif_target_keeps_exact_palette_when_smaller_caps_cannot_change_it(self):
        source = self.path / "source.gif"
        source.write_bytes(gif_bytes(2))
        standard = self.path / "standard.gif"
        constrained = self.path / "constrained.gif"
        expected = self.convert(source, standard, format="gif")
        actual = self.convert(source, constrained, 1, format="gif")
        self.assertEqual(actual, expected)
        self.assertEqual(constrained.read_bytes(), standard.read_bytes())

    def test_frame_edit_budget_is_checked_before_decoding(self):
        manifest = self.path / "oversized"
        frame_edit(manifest, 4000, 4000, 0, [(self.path / "missing", 0, 100)] * 9)
        result = self.codec("preview-frames", manifest, check=False)
        self.assertEqual(result.stderr.strip(), b"ui:frameEditorBudget")

    def test_gif_target_shrinks_palette_and_keeps_canvas(self):
        width, height = 128, 64
        rng = random.Random(42)
        source = self.path / "colors.png"
        result = self.path / "colors.gif"
        pixels = bytes(value for _ in range(width * height)
                       for value in (rng.randrange(256), rng.randrange(256), rng.randrange(256), 255))
        png(source, width, height, pixels)
        initial = self.convert(source, result, format="gif")["output"]
        target = self.convert(source, result, initial["bytes"] * 3 // 4, format="gif")
        self.assertEqual(target["output"]["format"], "GIF")
        self.assertLess(target["quality"], 256)
        self.assertLessEqual(target["output"]["bytes"], initial["bytes"] * 3 // 4)
        self.assertEqual((target["output"]["width"], target["output"]["height"]), (width, height))

    def test_still_gif_keeps_all_256_colors_when_partial_alpha_rounds_opaque(self):
        source = self.path / "palette.png"
        result = self.path / "palette.gif"
        pixels = bytes(channel for r in range(16) for g in range(16)
                       for channel in (r * 16, g * 16, 0, 128))
        png(source, 16, 16, pixels)
        decoded, = self.preview(source)
        expected = bytearray(decoded)
        expected[3::4] = b"\xff" * 256
        self.assertEqual(len(set(zip(decoded[0::4], decoded[1::4], decoded[2::4]))), 256)
        report = self.convert(source, result, format="gif")
        self.assertTrue(report["source"]["alpha"])
        self.assertFalse(report["output"]["alpha"])
        self.assertFalse(report["output"]["animated"])
        self.assertEqual(report["output"]["delays"], [0])
        self.assertEqual(self.preview(result), [bytes(expected)])

    def test_independent_strengths_and_preview_export_parity(self):
        source = self.path / "detail.png"
        values = [0, 40, 56, 40, 135, 40, 255]
        png(source, len(values), 3, bytes(channel for value in values * 3
                                        for channel in (value, value, value, 255)))
        raw, = self.preview(source, strengths=(0, 0, 0))
        self.assertEqual(raw, self.preview(source)[0])
        for channel, sample, direction in [(0, 1, 1), (1, 2, -1), (2, 4, 1)]:
            strengths = [0, 0, 0]
            strengths[channel] = 30
            mild = self.preview(source, strengths=strengths)[0]
            strengths[channel] = 90
            strong = self.preview(source, strengths=strengths)[0]
            sample *= 4
            self.assertGreater(direction * (mild[sample] - raw[sample]), 0)
            self.assertGreater(direction * (strong[sample] - mild[sample]), 0)
        result = self.path / "detail.webp"
        strengths = (77, 64, 42)
        self.convert(source, result, strengths=strengths)
        self.assertEqual(self.preview(result), self.preview(source, strengths=strengths))

    def test_adjusts_gif_apng_and_webp_preserving_animation_metadata(self):
        gif = self.path / "motion.gif"
        gif.write_bytes(gif_bytes(2).replace(PALETTE, bytes([0, 0, 0, 40, 40, 40, 150, 150, 150, 0, 0, 255])))
        apng_path = self.path / "motion.png"
        apng(apng_path)
        path = self.path / "motion.webp"
        self.convert(gif, path)
        strengths = (70, 40, 80)
        for source, timing in [(gif, (3, [10, 30, 0, 170, 10])),
                               (apng_path, (3, [17, 83, 123])),
                               (path, (3, [10, 30, 0, 170, 10]))]:
            with self.subTest(source=source.name):
                result = self.path / "adjusted.webp"
                stats = self.convert(source, result, strengths=strengths)
                self.assertFalse(stats["unchanged"])
                self.assertEqual(riff_metadata(result), timing)
                self.assertEqual(self.preview(result), self.preview(source, strengths=strengths))
                for before, after in zip(self.preview(source), self.preview(result)):
                    self.assertEqual(before[3::4], after[3::4])
        self.assertNotEqual(self.preview(path), self.preview(path, strengths=strengths))

    def test_adjustment_keeps_single_frame_animation(self):
        source = self.path / "single.png"
        source.write_bytes(png_header(4, 3)
            + png_chunk(b"acTL", struct.pack(">II", 1, 5))
            + png_chunk(b"fcTL", struct.pack(">IIIIIHHBB", 0, 4, 3, 0, 0, 83, 1000, 0, 0))
            + png_chunk(b"IDAT", png_rows(4, bytes([40, 40, 40, 128]) * 12))
            + png_chunk(b"IEND", b""))
        result = self.path / "single.webp"
        self.convert(source, result)
        adjusted = self.path / "single-adjusted.webp"
        stats = self.convert(result, adjusted, strengths=(85, 0, 0))
        self.assertFalse(stats["unchanged"])
        self.assertEqual(riff_metadata(adjusted), (5, [83]))
        self.assertEqual(self.preview(adjusted), self.preview(result, strengths=(85, 0, 0)))
        self.assertNotEqual(self.preview(adjusted), self.preview(result))

    def test_gif_visible_pixels_delays_and_finite_loop(self):
        source = self.path / "透明 子帧.gif"
        source.write_bytes(gif_bytes(2))
        result = self.path / "optimized.webp"
        stats = self.convert(source, result)
        self.assertTrue(stats["output"]["alpha"])
        self.assertEqual(riff_metadata(result), (3, [10, 30, 0, 170, 10]))

        def frame(extra=None):
            pixels = [RED] + [CLEAR] * 11
            if extra:
                pixels[extra[0]] = extra[1]
            return b"".join(pixels)

        expected = [frame(), frame((1, GREEN)), frame((6, BLUE)), frame((11, GREEN)), frame((11, GREEN))]
        self.assertEqual(self.preview(source), expected)
        self.assertEqual(self.preview(result), expected)

    def test_gif_no_loop_and_infinite_loop(self):
        for repeats, total in [(None, 1), (0, 0)]:
            with self.subTest(repeats=repeats):
                source = self.path / "input.gif"
                result = self.path / "output.webp"
                source.write_bytes(gif_bytes(repeats))
                self.convert(source, result)
                self.assertEqual(riff_metadata(result)[0], total)

    def test_finite_loop_count_over_webp_limit_is_capped(self):
        gif = self.path / "many.gif"
        gif.write_bytes(gif_bytes(65535))
        png_path = self.path / "many.png"
        apng(png_path, plays=200000)
        for source, plays, delays in [(gif, 65536, [10, 30, 0, 170, 10]),
                                      (png_path, 200000, [17, 83, 123])]:
            with self.subTest(source=source.name):
                target = self.path / "limited.webp"
                result = self.convert(source, target)
                self.assertEqual(result["source"]["plays"], plays)
                self.assertEqual(result["output"]["plays"], 65535)
                self.assertEqual(riff_metadata(target), (65535, delays))
                self.assertEqual(self.preview(source), self.preview(target))

    def test_target_preserves_partial_alpha_of_animated_webp(self):
        width, height = 128, 112
        generator = random.Random(27)
        frames = []
        for index in range(3):
            rgba = bytearray()
            for y in range(height):
                for x in range(width):
                    rgb = generator.randbytes(3)
                    alpha = (0, 76, 128, 255)[(x // 12 + y // 10 + index) % 4]
                    rgba.extend(rgb + bytes([alpha]))
            path = self.path / f"{index}.png"
            png(path, width, height, rgba)
            frames.append(path)
        source = self.path / "input.webp"
        subprocess.run(
            ["img2webp", "-lossless", "-loop", "4", "-d", "17", frames[0],
             "-d", "83", frames[1], "-d", "123", frames[2], "-o", source],
            check=True, capture_output=True,
        )
        target = source.stat().st_size // 2
        result = self.path / "optimized.webp"
        stats = self.convert(source, result, target)
        self.assertLessEqual(result.stat().st_size, target)
        self.assertEqual(result.stat().st_size, stats["output"]["bytes"])
        self.assertFalse(stats["unchanged"])
        self.assertGreaterEqual(stats["quality"], 0)
        self.assertEqual(riff_metadata(result), (4, [17, 83, 123]))
        for before, after in zip(self.preview(source), self.preview(result)):
            self.assertEqual(before[3::4], after[3::4])
            self.assertIn(128, after[3::4])

    def test_too_small_target_still_reports_actual_size(self):
        source = self.path / "input.gif"
        source.write_bytes(gif_bytes(2))
        result = self.path / "output.webp"
        stats = self.convert(source, result, 10)
        self.assertGreater(stats["output"]["bytes"], 10)
        self.assertEqual(stats["output"]["bytes"], result.stat().st_size)
        self.assertEqual(riff_metadata(result)[0], 3)

    def test_same_format_keeps_smaller_original(self):
        png_path = self.path / "flat.png"
        png(png_path, 8, 8, RED * 64)
        source = self.path / "already-small.webp"
        subprocess.run(["cwebp", "-lossless", "-z", "9", png_path, "-o", source],
                       check=True, capture_output=True)
        initial = source.read_bytes()
        result = self.path / "output.webp"
        stats = self.convert(source, result)
        self.assertTrue(stats["unchanged"])
        self.assertFalse(result.exists())
        self.assertEqual(source.read_bytes(), initial)

    def test_apng_keeps_partial_alpha_and_restores_previous_frame(self):
        source = self.path / "animation.png"
        expected = apng(source)
        result = self.path / "animation.webp"
        report = self.convert(source, result)
        self.assertEqual(report["source"]["format"], "APNG")
        self.assertEqual(riff_metadata(result), (3, [17, 83, 123]))
        self.assertEqual(self.preview(source), expected)
        self.assertEqual(self.preview(result), expected)

    def test_apng_poster_clears_before_first_partial_frame(self):
        source = self.path / "with-poster.apng"
        result = self.path / "with-poster.webp"

        def control(sequence, x, y, delay):
            return png_chunk(b"fcTL", struct.pack(">IIIIIHHBB", sequence, 1, 1, x, y, delay, 1000, 0, 0))

        source.write_bytes(png_header(4, 3)
            + png_chunk(b"acTL", struct.pack(">II", 2, 2))
            + png_chunk(b"IDAT", png_rows(4, GREEN * 12))
            + control(0, 1, 1, 17)
            + png_chunk(b"fdAT", struct.pack(">I", 1) + png_rows(1, RED))
            + control(2, 3, 2, 83)
            + png_chunk(b"fdAT", struct.pack(">I", 3) + png_rows(1, BLUE))
            + png_chunk(b"IEND", b""))
        self.convert(source, result)
        first = CLEAR * 5 + RED + CLEAR * 6
        self.assertEqual(riff_metadata(result), (2, [17, 83]))
        self.assertEqual(self.preview(result), [first, first[:-4] + BLUE])

    def test_static_png_jpeg_tiff_bmp_and_ico(self):
        source = self.path / "sample.png"
        semi_green = bytes([0, 255, 0, 128])
        pixels = (RED * 8 + semi_green * 8 + CLEAR * 16) * 32
        png(source, 32, 32, pixels)
        for format_name in ("png", "jpeg", "tiff", "bmp", "ico"):
            original = source
            if format_name != "png":
                original = source.with_suffix("." + format_name)
                subprocess.run(["sips", "-s", "format", format_name, source, "--out", original],
                               check=True, capture_output=True)
            decoded, = self.preview(original)
            if format_name == "png":
                self.assertEqual(decoded, pixels)
            for output_format in ("webp", "gif"):
                with self.subTest(source_format=format_name, output_format=output_format):
                    result = self.path / f"{format_name}.{output_format}"
                    report = self.convert(original, result, format=output_format)
                    self.assertEqual(report["source"]["format"], format_name.upper())
                    output = report["output"]
                    self.assertEqual(output["format"], "WebP" if output_format == "webp" else "GIF")
                    self.assertFalse(output["animated"])
                    self.assertEqual(output["delays"], [0])
                    self.assertEqual(output["plays"], 1)
                    self.assertEqual((output["width"], output["height"]), (32, 32))
                    image, = self.preview(result)
                    if output_format == "webp":
                        self.assertEqual(image, decoded)
                        self.assertEqual(riff_metadata(result), (None, []))
                    else:
                        self.assertEqual(image[3::4], bytes(255 if a >= 128 else 0 for a in decoded[3::4]))
                        self.assertEqual(output["alpha"], 0 in image[3::4])
                        self.assertNotIn(b"NETSCAPE2.0", result.read_bytes())

    def test_still_alpha_on_both_sides_of_gif_threshold(self):
        source = self.path / "alpha.png"
        pixels = RED + bytes((0, 255, 0, 127)) + bytes((0, 255, 0, 128)) + CLEAR
        png(source, 4, 1, pixels)
        for format_name, expected in [("webp", pixels), ("gif", RED + CLEAR + GREEN + CLEAR)]:
            result = self.path / f"threshold.{format_name}"
            report = self.convert(source, result, format=format_name)
            self.assertTrue(report["output"]["alpha"])
            self.assertEqual(self.preview(result), [expected])

    def test_multi_size_ico_uses_largest_image(self):
        images = []
        for size, color in [(16, RED), (32, BLUE)]:
            image = self.path / f"{size}.png"
            png(image, size, size, color * size * size)
            images.append(image.read_bytes())
        offset = 6 + 16 * len(images)
        index = []
        for size, image in zip((16, 32), images):
            index.append(struct.pack("<BBBBHHII", size, size, 0, 0, 1, 32, len(image), offset))
            offset += len(image)
        source = self.path / "multiple.ico"
        source.write_bytes(struct.pack("<HHH", 0, 1, 2) + b"".join(index + images))
        result = self.path / "multiple.webp"
        report = self.convert(source, result)
        self.assertEqual((report["output"]["width"], report["output"]["height"]), (32, 32))
        self.assertEqual(self.preview(result), [BLUE * (32 * 32)])

    def test_jpeg_orientation_is_applied(self):
        source = self.path / "landscape.png"
        png(source, 4, 2, RED * 2 + BLUE * 2 + RED * 2 + BLUE * 2)
        jpeg = self.path / "rotated.jpg"
        subprocess.run(["sips", "-s", "format", "jpeg", source, "--out", jpeg],
                       check=True, capture_output=True)
        data = jpeg.read_bytes()
        self.assertEqual(data[:2], b"\xff\xd8")
        tiff = b"II" + struct.pack("<HIHHHIHI", 42, 8, 1, 274, 3, 1, 6, 0) + b"\0\0"
        exif = b"Exif\0\0" + tiff
        jpeg.write_bytes(data[:2] + b"\xff\xe1" + struct.pack(">H", len(exif) + 2) + exif + data[2:])
        for output_format in ("webp", "gif"):
            with self.subTest(output_format=output_format):
                result = self.path / f"rotated.{output_format}"
                report = self.convert(jpeg, result, format=output_format)
                self.assertEqual((report["output"]["width"], report["output"]["height"]), (2, 4))
                pixels, = self.preview(result)
                self.assertGreater(pixels[0], pixels[2])
                self.assertGreater(pixels[-2], pixels[-4])

    def test_bad_source_is_rejected_without_output(self):
        source = self.path / "broken.gif"
        data = gif_bytes(0)
        source.write_bytes(data[:data.index(b"\x2c") + 11])
        output = self.path / "output.webp"
        result = self.codec("convert", source, output, 0, check=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(output.exists())

    def test_gif_with_missing_trailer_recovers_all_complete_frames(self):
        data = gif_bytes(2)
        source = self.path / "no-trailer.gif"
        source.write_bytes(data[:-1])
        output = self.path / "recovered.webp"
        result = self.convert(source, output)
        self.assertTrue(result["source"]["recovered"])
        self.assertFalse(result["output"]["recovered"])
        self.assertEqual(riff_metadata(output), (3, [10, 30, 0, 170, 10]))

    def test_gif_interrupted_by_web_content_recovers_only_complete_frames(self):
        data = gif_bytes(2)
        end_of_good_frames = data.rindex(b"\x21\xf9\x04")
        # Last control block, descriptor, LZW code size and first sub-block length.
        prefix = data[:end_of_good_frames + 8 + 10 + 2]
        source = self.path / "interrupted.gif"
        source.write_bytes(prefix + b"<!DOCTYPE html><html></html>")
        expected = self.path / "complete-prefix.gif"
        expected.write_bytes(data[:end_of_good_frames] + b"\x3b")
        output = self.path / "recovered.webp"
        result = self.convert(source, output)
        self.assertTrue(result["source"]["recovered"])
        self.assertEqual(self.preview(output), self.preview(expected))
        self.assertEqual(riff_metadata(output), (3, [10, 30, 0, 170]))


if __name__ == "__main__":
    unittest.main(verbosity=2)
