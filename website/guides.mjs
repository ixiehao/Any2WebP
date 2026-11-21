export const guides = {
  "gif-to-webp": {
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
};
