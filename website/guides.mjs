export const guides = {
  "gif-to-webp": {
    related: "compress-webp",
    en: {
      title: "How to Convert Animated GIF to WebP on Mac",
      description: "Convert animated GIF to lossless WebP locally on Mac. Compare the output frame by frame and check transparency, delays, and loop count before sharing.",
      steps: [
        "Open Any2WebP and use Convert Files, or drag animated GIFs into the queue. You can convert several GIFs in one batch.",
        "Select WebP and choose Lossless. Click Export. If you have a size limit, switch to Target size and enter the limit in KB per file.",
        "Play both previews together or step through them. In Output details, check the canvas size, frame delay, play count, and transparency before using the result.",
      ],
      detailHeading: "Does conversion keep transparency and frame timing?",
      detail: "Lossless WebP preserves the decoded image, including transparent areas. Any2WebP carries over frame delays and play count where WebP can represent them. For example, the Teal Hummingbird export kept all 60 frames, its transparent background, and its three-second infinite loop.",
    },
    zh: {
      title: "如何在 Mac 上将 GIF 转成 WebP 动图",
      description: "在 Mac 本机批量将 GIF 转为无损 WebP 动图。导出后同步逐帧检查透明度、帧延时和播放次数，可按 KB 设定目标体积。",
      steps: [
        "打开 Any2WebP，点击「转换文件」或把 GIF 拖入队列。可以一次选入多个动图批量转换。",
        "导出格式选 WebP，压缩方式选「无损压缩」，然后点击导出。文件有大小限制时，改选「按目标体积」，用 KB 填写单个文件的目标上限。",
        "同步播放原图和成品，也可以逐帧查看。在「成品信息」核对画布尺寸、帧延时、播放次数和透明度，再使用导出的文件。",
      ],
      detailHeading: "GIF 转 WebP 后，透明度和帧延时能保留吗？",
      detail: "无损 WebP 会保留解码后的画面和透明区域。帧延时、播放次数在 WebP 可表示的范围内沿用原值。实测的「青羽蜂鸟」成品保留了 60 帧、透明背景和 3 秒无限循环。",
    },
    ja: {
      title: "Mac でアニメーション GIF を WebP に変換する方法",
      description: "Mac 上でアニメーション GIF を可逆 WebP に一括変換。変換前後をコマ送りで比較し、透過、表示時間、ループ回数を確認できます。",
      steps: [
        "Any2WebP の「ファイルを変換」を選ぶか、GIF をキューにドラッグします。複数の GIF を一括変換できます。",
        "出力形式に WebP、圧縮方式に「可逆圧縮」を選んで書き出します。容量に制限がある場合は「目標サイズ」を選び、1 ファイルあたりの上限を KB で指定します。",
        "変換前後を同期再生するか、コマ送りで比較します。書き出した画像を使う前に、出力情報でキャンバスの寸法、フレームの表示時間、再生回数、透過を確認します。",
      ],
      detailHeading: "変換後も透過とフレームの表示時間は保たれますか？",
      detail: "可逆 WebP は、デコードした画像と透過領域を保持します。フレームの表示時間と再生回数は、WebP で表現できる範囲で引き継ぎます。ハチドリの実例では、60 フレームと透過背景、3 秒の無限ループを維持しました。",
    },
  },
  "compress-webp": {
    related: "gif-to-webp",
    en: {
      title: "How to Compress WebP to a Target File Size on Mac",
      description: "Batch compress WebP images and animations to a target in KB. Check the actual file size and compare the result with the original on your Mac.",
      steps: [
        "Drag in the WebP files you want to reduce, or add JPG or PNG images if you also want to convert them to WebP.",
        "Choose WebP and Target size. For a 200 KB upload limit, enter 200 as the limit per file. Any2WebP tries lossless compression first and reduces quality if needed.",
        "Export and check each item's actual size. Compare the original and output at the same point in the animation. If an item shows Over target, review the smallest result saved before uploading.",
      ],
      detailHeading: "What if an animation stays over the limit?",
      detail: "A target is a size to aim for. If you still need a smaller file after comparing quality, remove unnecessary frames in Edit Frames. For a video clip, shorten the selection or reduce its frame rate or output dimensions before exporting again. Target size mode also works for GIF, where the app reduces colors as needed.",
    },
    zh: {
      title: "如何在 Mac 上按目标体积压缩 WebP",
      description: "在 Mac 本机批量压缩 WebP 静图和动图，用 KB 设置单个文件的目标体积，核对实际大小和压缩前后的画面。",
      steps: [
        "拖入要压缩的 WebP 文件。也可以加入 JPG、PNG，在同一队列里转换成 WebP。",
        "选择 WebP 和「按目标体积」。上传上限为 200 KB 时，将单个文件的上限填为 200。软件优先尝试无损压缩，必要时降低画质。",
        "导出后核对每个文件的实际大小。动图可以同步播放，比较同一时刻的原图与成品。显示「未达标」时，先检查已保存的最小结果，再决定是否上传。",
      ],
      detailHeading: "动图仍超出体积限制怎么办？",
      detail: "需要进一步缩小时，可用「编辑帧」删除不必要的帧。视频片段可缩短选区、降低帧率或减小输出尺寸后再导出。「按目标体积」也适用于 GIF，软件会按需要减少颜色。",
    },
    ja: {
      title: "Mac で容量を指定して WebP を圧縮する方法",
      description: "WebP の静止画やアニメーションを Mac で一括圧縮。目標サイズを KB で指定し、実際の容量と変換前後の画質を確認できます。",
      steps: [
        "圧縮する WebP をドラッグします。JPG や PNG を同じキューに追加し、WebP に変換することもできます。",
        "WebP と「目標サイズ」を選びます。アップロード上限が 200 KB なら、1 ファイルあたりの上限に 200 と入力します。まず可逆圧縮を試し、必要に応じて画質を下げます。",
        "書き出して各ファイルの実際の容量を確認し、アニメーションの同じ場面を比較します。「目標サイズ超過」と表示された場合は、保存された最小の結果をアップロード前に確認します。",
      ],
      detailHeading: "アニメーションが目標サイズを超えた場合は？",
      detail: "さらに容量を減らすには、フレーム編集で不要なフレームを削除します。動画から作る場合は、範囲を短くするか、フレームレートや出力寸法を下げてから書き出します。GIF にも目標サイズを指定でき、必要に応じて色数が減ります。",
    },
  },
  "video-to-webp-gif": {
    related: "images-to-webp-gif",
    en: {
      title: "How to Turn a Video Clip into a WebP or GIF on Mac",
      description: "Trim an MP4, MOV, or WebM on your Mac, set the frame rate and output dimensions, then export the clip as animated WebP or GIF in Any2WebP.",
      steps: [
        "Open Any2WebP. Choose Help → Check Dependencies and follow the prompts if FFmpeg or ffprobe is missing. Click Animate Video and select an MP4, MOV, or WebM file.",
        "Click Trim Clip. Drag the start and end handles on the timeline or enter the times, then select Apply Trim. In the main window, set the frame rate and long edge for the animation.",
        "Choose WebP or GIF in Export settings. Set a target size in KB if you have an upload limit. Export, then compare the selected clip and the output in the synchronized preview. The animation has no audio.",
      ],
      detailHeading: "What settings should I start with?",
      detail: "Try a short clip, such as 00:08 to 00:12, at 12 FPS and a 640 px long edge. If the clip exceeds the duration shown in the trim window, shorten the selection or lower the frame rate or long edge. Choose GIF for destinations that require it. WebP supports more colors and partial transparency.",
    },
    zh: {
      title: "如何在 Mac 上将视频片段制作成 WebP 或 GIF 动图",
      description: "在 Mac 上截取 MP4、MOV 或 WebM 的一段，设置帧率和长边尺寸，用 Any2WebP 导出 WebP 或 GIF 动图。",
      steps: [
        "打开 Any2WebP，在「帮助 → 检查依赖」确认 FFmpeg 和 ffprobe 已就绪。点击「视频转动图」，选择 MP4、MOV 或 WebM 文件。",
        "点击「剪切片段」，在时间轴上拖动起止点，也可以直接输入时间。点击「确认剪切」后回到主窗口，设置导出帧率和长边尺寸。",
        "在「导出设置」里选 WebP 或 GIF。有上传限制时，可用「按目标体积」填写 KB 上限。导出后同步播放原片段和成品，检查截取范围与播放速度。导出的动图没有声音。",
      ],
      detailHeading: "帧率、尺寸和时长怎么选？",
      detail: "可以先截取 00:08 到 00:12 的 4 秒片段，以 12 FPS、长边 640 px 导出。剪切窗口会显示当前设置允许的最长时长。超过上限时，可缩短片段、降低帧率或减小长边。有的平台只接收 GIF，遇到这种情况就选 GIF。WebP 适合需要保留更多颜色和半透明的画面。",
    },
    ja: {
      title: "Mac で動画の一部を WebP・GIF アニメーションにする方法",
      description: "Any2WebP で MP4・MOV・WebM を切り出し、フレームレートと長辺を指定して、Mac 上で WebP または GIF に書き出します。",
      steps: [
        "Any2WebP を開き、「ヘルプ → 依存ツールを確認」で FFmpeg と ffprobe を確認します。「動画をアニメ化」を選び、MP4、MOV、WebM のいずれかを開きます。",
        "「動画をトリミング」でタイムラインの開始・終了ハンドルを動かすか、時刻を直接入力します。「トリミングを確定」で戻り、フレームレートと長辺を設定します。",
        "「書き出し設定」で WebP か GIF を選びます。容量制限がある場合は「目標サイズ」を KB で指定します。書き出したら元の範囲と同期再生して確認します。出力に音声は含まれません。",
      ],
      detailHeading: "フレームレート、寸法、長さの目安は？",
      detail: "まず 00:08 から 00:12 までの 4 秒間を、12 FPS、長辺 640 px で試せます。トリミング画面に表示される上限を超えた場合は、範囲を短くするか、フレームレートや長辺を下げます。GIF のみ受け付けるサービスには GIF を選びます。WebP はより多くの色や半透明に対応しています。",
    },
  },
  "images-to-webp-gif": {
    related: "video-to-webp-gif",
    en: {
      title: "How to Make a WebP or GIF from a Series of Images on Mac",
      description: "Combine a JPG or PNG sequence into an animated WebP or GIF on Mac. Arrange frames, set their timing, and preview the result in Any2WebP.",
      steps: [
        "Open Any2WebP, click Combine Images, and select at least two still images, such as JPGs or PNGs. The frame editor sorts filenames naturally, so 1, 2, and 10 appear in that order.",
        "Drag the thumbnails to change the order. Set a Uniform frame rate and click Apply to All Frames. You can then select a frame and enter its duration in milliseconds. Check the total duration before clicking Apply Edits.",
        "Choose WebP or GIF in Export settings and export the animation. Use the preview and Output details to check the canvas, frame delays, plays, and transparency.",
      ],
      detailHeading: "How can I control the timing and canvas?",
      detail: "At 10 FPS each frame lasts 100 ms, so 20 frames play for two seconds. Set the last frame to 500 ms if you want a longer pause at the end. Images with different aspect ratios are fitted proportionally to one canvas. WebP can keep the transparent margins and partial transparency. GIF pixels are either fully transparent or opaque.",
    },
    zh: {
      title: "如何在 Mac 上用系列图片合成 WebP 或 GIF 动图",
      description: "用 Any2WebP 在 Mac 本机将一组 JPG、PNG 图片做成 WebP 或 GIF 动图，可拖动调整顺序、设置帧率和单帧停留时间。",
      steps: [
        "打开 Any2WebP，点击「多图合成动图」，选入至少两张 JPG、PNG 等静态图片。帧编辑器会按文件名自然排序，例如 1、2、10。",
        "拖动缩略图调整顺序。设置「统一帧率」后点击「应用到所有帧」。还可以选中一帧，用毫秒设置「单帧停留时间」。检查总时长后点击「应用编辑」。",
        "在「导出设置」里选 WebP 或 GIF 并导出。在「成品信息」查看画布尺寸、帧延时、播放次数和透明度，也可以逐帧预览。",
      ],
      detailHeading: "怎么控制播放速度和画布？",
      detail: "例如，20 张图片设为 10 FPS，每帧停留 100 ms，总时长是 2 秒。若想让结尾多停一会儿，可把最后一帧改为 500 ms。比例不同的图片会等比放入同一画布。WebP 可以保留透明留白和半透明，GIF 的像素只能全透明或不透明。",
    },
    ja: {
      title: "Mac で複数の画像から WebP・GIF アニメーションを作る方法",
      description: "JPG や PNG の連番画像を Mac で WebP・GIF に合成。Any2WebP でフレームの順序や表示時間を調整し、書き出す方法を紹介します。",
      steps: [
        "Any2WebP で「画像を合成」を選び、JPG や PNG などの静止画を 2 枚以上選びます。ファイル名は 1、2、10 のような数字順に並びます。",
        "サムネイルをドラッグして順序を変えます。「一定のフレームレート」を選んで「全フレームに適用」を押します。個別のフレームを選び、表示時間をミリ秒で指定することもできます。合計時間を確認して「編集を適用」を押します。",
        "「書き出し設定」で WebP か GIF を選び、書き出します。出力情報でキャンバスの寸法、フレームの表示時間、再生回数、透過を確認できます。",
      ],
      detailHeading: "再生速度とキャンバスを調整するには？",
      detail: "20 枚を 10 FPS にすると、1 枚の表示時間は 100 ms で、全体は 2 秒です。最後の画像を長く見せるなら、そのフレームを 500 ms にします。縦横比の異なる画像は、比率を保ったまま同じキャンバスに収まります。WebP は透明な余白と半透明を保持でき、GIF では完全透明か不透明になります。",
    },
  },
};
