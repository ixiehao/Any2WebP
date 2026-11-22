// Included by codec.c after the shared image and allocation helpers.
static void check_wic(HRESULT result) {
    if (FAILED(result)) fail("ui:decodeImage");
}

static void reject_animated_png(WebPData data) {
    for (size_t offset = 8; data.size - offset >= 12;) {
        const uint8_t *type = data.bytes + offset + 4;
        if (!memcmp(type, "acTL", 4) || !memcmp(type, "fcTL", 4)) {
            fail("ui:windowsAnimatedPng");
        }
        size_t size = read_be32(data.bytes + offset);
        if (size > data.size - offset - 12) break;
        offset += size + 12;
    }
}

static unsigned jpeg_orientation(IWICBitmapFrameDecode *frame) {
    IWICMetadataQueryReader *metadata = NULL;
    unsigned orientation = 1;
    if (SUCCEEDED(IWICBitmapFrameDecode_GetMetadataQueryReader(frame, &metadata))) {
        PROPVARIANT value = {0};
        if (SUCCEEDED(IWICMetadataQueryReader_GetMetadataByName(metadata, L"/app1/ifd/{ushort=274}", &value)) &&
            value.vt == VT_UI2 && value.uiVal >= 1 && value.uiVal <= 8) {
            orientation = value.uiVal;
        }
        PropVariantClear(&value);
        IWICMetadataQueryReader_Release(metadata);
    }
    return orientation;
}

static void decode_still(WebPData data, Animation *a) {
    bool png = data.size >= 8 && !memcmp(data.bytes, "\x89PNG\r\n\x1a\n", 8);
    bool jpeg = data.size >= 3 && !memcmp(data.bytes, "\xff\xd8\xff", 3);
    if (!png && !jpeg) fail("ui:unsupportedImage");
    if (png) reject_animated_png(data);

    check_wic(CoInitializeEx(NULL, COINIT_MULTITHREADED));
    IWICImagingFactory *factory = NULL;
    IWICStream *stream = NULL;
    IWICBitmapDecoder *decoder = NULL;
    IWICBitmapFrameDecode *frame = NULL;
    IWICFormatConverter *converter = NULL;
    check_wic(CoCreateInstance(&CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER,
                               &IID_IWICImagingFactory, (void **)&factory));
    check_wic(IWICImagingFactory_CreateStream(factory, &stream));
    check_wic(IWICStream_InitializeFromMemory(stream, (BYTE *)data.bytes, (DWORD)data.size));
    check_wic(IWICImagingFactory_CreateDecoder(factory, png ? &GUID_ContainerFormatPng : &GUID_ContainerFormatJpeg,
                                             &GUID_VendorMicrosoft, &decoder));
    check_wic(IWICBitmapDecoder_Initialize(decoder, (IStream *)stream, WICDecodeMetadataCacheOnDemand));
    check_wic(IWICBitmapDecoder_GetFrame(decoder, 0, &frame));

    UINT width, height;
    check_wic(IWICBitmapFrameDecode_GetSize(frame, &width, &height));
    unsigned orientation = jpeg ? jpeg_orientation(frame) : 1;
    dimensions(a, orientation >= 5 ? height : width, orientation >= 5 ? width : height);
    a->plays = 1;
    a->format = png ? "PNG" : "JPEG";
    check_wic(IWICImagingFactory_CreateFormatConverter(factory, &converter));
    check_wic(IWICFormatConverter_Initialize(converter, (IWICBitmapSource *)frame, &GUID_WICPixelFormat32bppRGBA,
                                          WICBitmapDitherTypeNone, NULL, 0, WICBitmapPaletteTypeCustom));
    uint8_t *pixels = allocate(frame_bytes(a));
    check_wic(IWICFormatConverter_CopyPixels(converter, NULL, width * 4, (UINT)frame_bytes(a), pixels));
    if (orientation != 1) {
        uint8_t *oriented = allocate(frame_bytes(a));
        for (UINT y = 0; y < height; y++) {
            for (UINT x = 0; x < width; x++) {
                UINT row = y, col = x;
                switch (orientation) {
                    case 2: col = width - 1 - x; break;
                    case 3: col = width - 1 - x; row = height - 1 - y; break;
                    case 4: row = height - 1 - y; break;
                    case 5: col = y; row = x; break;
                    case 6: col = height - 1 - y; row = x; break;
                    case 7: col = height - 1 - y; row = width - 1 - x; break;
                    case 8: col = y; row = width - 1 - x; break;
                }
                memcpy(oriented + ((size_t)row * a->width + col) * 4,
                       pixels + ((size_t)y * width + x) * 4, 4);
            }
        }
        free(pixels);
        pixels = oriented;
    }
    store_frame(a, next_frame(a), pixels, 0);

    IWICFormatConverter_Release(converter);
    IWICBitmapFrameDecode_Release(frame);
    IWICBitmapDecoder_Release(decoder);
    IWICStream_Release(stream);
    IWICImagingFactory_Release(factory);
    CoUninitialize();
}
