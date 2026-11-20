"""Settings for dmgbuild and validation of the finished, mounted Finder layout."""

import os
import struct
import sys
from pathlib import Path


width, height = 680, 430
icon_size = 108
app_location = (181, 193)
applications_location = (499, 193)
window_rect = ((160, 120), (width, height))


if "defines" in globals():
    application = defines["app"]
    format = "UDZO"
    filesystem = "HFS+"
    files = [application]
    symlinks = {"Applications": "/Applications"}
    background = defines["background"]
    show_toolbar = False
    show_status_bar = False
    show_sidebar = False
    show_pathbar = False
    show_tab_view = False
    default_view = "icon-view"
    icon_view_settings = {"arrange_by": None, "icon_size": icon_size, "text_size": 13}
    icon_locations = {
        Path(application).name: app_location,
        "Applications": applications_location,
    }
elif __name__ == "__main__":
    from ds_store import DSStore
    from mac_alias import Alias

    def require(condition, detail):
        if not condition:
            raise SystemExit(detail)

    mount, app_name = Path(sys.argv[1]), sys.argv[2]
    applications = mount / "Applications"
    image = mount / ".background.png"
    require(applications.is_symlink() and os.readlink(applications) == "/Applications",
            "Applications does not link to /Applications")
    require((mount / app_name / "Contents/Info.plist").is_file(), "The application bundle is missing")
    require(image.is_file(), "Finder background is missing")
    with image.open("rb") as png:
        header = png.read(24)
    require(header[:8] == b"\x89PNG\r\n\x1a\n" and header[12:16] == b"IHDR"
            and struct.unpack(">II", header[16:24]) == (width, height), "Unexpected Finder background dimensions")

    metadata = mount / ".DS_Store"
    require(metadata.is_file(), "Finder layout is missing")
    with DSStore.open(str(metadata), "r") as store:
        require(store["."]["icvl"] == (b"type", b"icnv"), "Finder did not default to icon view")
        window = store["."]["bwsp"]
        (left, top), _ = window_rect
        require(window["WindowBounds"] == f"{{{{{left}, {top}}}, {{{width}, {height}}}}}",
                "Unexpected Finder window bounds")
        require(not any(window.get(key) for key in ("ShowToolbar", "ShowSidebar", "ShowStatusBar", "ShowPathbar")),
                "Unexpected Finder window controls")
        view = store["."]["icvp"]
        require(view["backgroundType"] == 2 and view["iconSize"] == icon_size and view["arrangeBy"] == "none",
                "Unexpected Finder background or icon-view settings")
        require(store[app_name]["Iloc"] == app_location and store["Applications"]["Iloc"] == applications_location,
                "Unexpected icon positions")
        require(not list(store.find(".", b"pBBk")), "Obsolete background bookmark can hide the background")
        saved = Alias.from_bytes(view["backgroundImageAlias"]).target
        actual = Alias.for_file(str(image)).target
        require((saved.cnid, saved.creation_date) == (actual.cnid, actual.creation_date),
                "Finder background alias points to a different object")
    print("Finder installation layout verified: image, alias, bounds, icons and Applications link")
