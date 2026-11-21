export const guideScreenshotSize = { width: 2480, height: 1556 };

export const guideScreens = {
  "gif-to-webp": [
    {
      id: "gif-export",
      en: ["Side-by-side view of an original GIF and a WebP result in Any2WebP", "The lossless WebP export keeps the GIF’s frame delays, loop, and transparent background."],
      zh: ["Any2WebP 中并排显示原 GIF 和 WebP 成品", "无损导出后，在成品信息中核对帧延时、播放次数和透明度。"],
      ja: ["Any2WebP で元の GIF と WebP の書き出し結果を並べた画面", "可逆 WebP の書き出し後、出力情報で表示時間、再生回数、透過を確認できます。"],
    },
  ],
  "compress-webp": [
    {
      id: "target-size",
      en: ["Export settings showing a 500 KB target and output details showing the actual file size", "Enter 500 KB as the limit per file. After exporting, check the actual size and whether the target was met."],
      zh: ["导出设置中的 500 KB 目标体积与成品的实际大小", "将单个文件的上限设为 500 KB，导出后检查实际大小及是否达标。"],
      ja: ["目標サイズ 500 KB の設定と、書き出し結果の実際の容量", "上限に 500 KB を指定し、書き出し後の容量と目標サイズ以内かどうかを確認します。"],
    },
  ],
  "video-to-webp-gif": [
    {
      id: "video-trim",
      en: ["Video trim dialog showing the filmstrip and a selection from 8 to 12 seconds", "Use the handles on the timeline or enter start and end times to keep only the part you want."],
      zh: ["视频剪切窗口的缩略图时间轴与 8 秒到 12 秒选区", "在时间轴上拖动起止手柄，也可以输入时间。本例保留第 8 秒到第 12 秒。"],
      ja: ["動画トリミング画面のサムネイルと 8〜12 秒の選択範囲", "開始・終了ハンドルを動かすか、時刻を入力します。この例では 8 秒から 12 秒までを残します。"],
    },
    {
      id: "video-export",
      en: ["Video export settings at 12 FPS and a 640 px long edge", "After trimming, set the frame rate and long edge below the preview. This WebP export has a 640 × 448 canvas."],
      zh: ["预览下方的 12 FPS 帧率和 640 px 长边设置", "确认剪切后，在主窗口设置帧率和长边。本例导出的 WebP 画布为 640 × 448。"],
      ja: ["プレビュー下の 12 FPS と長辺 640 px の設定", "トリミングを確定したら、フレームレートと長辺を設定します。この WebP の寸法は 640 × 448 です。"],
    },
  ],
  "images-to-webp-gif": [
    {
      id: "sequence-reorder",
      en: ["Frame editor showing thumbnails and an insertion marker before the second frame", "Drag the sixth thumbnail before the second one. The blue line marks where it will go."],
      zh: ["帧编辑器的缩略图和第二帧前的拖动插入线", "将第六张缩略图拖到第二帧之前，蓝线标出松手后的插入位置。"],
      ja: ["フレーム編集画面のサムネイルと、2 枚目の手前の挿入位置", "6 枚目を 2 枚目の手前にドラッグします。青い線が挿入位置を示します。"],
    },
    {
      id: "sequence-delay",
      en: ["Frame editor with the final thumbnail selected and its duration set to 500 ms", "After applying a uniform frame rate, select the last frame and set its duration to 500 ms."],
      zh: ["帧编辑器选中末帧，单帧停留时间为 500 ms", "应用统一帧率后，选中最后一帧，将单帧停留时间改为 500 ms。"],
      ja: ["最後のフレームを選択し、表示時間を 500 ms にした画面", "一定のフレームレートを適用してから、最後のフレームだけを 500 ms に設定します。"],
    },
  ],
};

export const guideScreenshotPath = (id, locale) => "assets/tutorials/" + id + "-" + locale + ".webp";
