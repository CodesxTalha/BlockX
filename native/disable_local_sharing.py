#!/usr/bin/env python3
"""
disable_local_sharing.py
------------------------
Turns off BlockX local machine sharing across all browser profiles and platforms
(Windows, macOS, and Linux).

When this script runs:
1. Unregisters the 'com.blockx.settings' native messaging host from all
   Chromium-family browsers (Chrome, Edge, Brave, Chromium, Vivaldi, including Flatpaks).
2. Cleans up native manifest JSON files and host wrapper scripts.
3. Archives the shared machine settings file (settings.json -> settings.json.bak)
   so no external file remains active.
4. Leaves the BlockX extension operating strictly in "browser-only" mode
   (using chrome.storage.local within the browser profile).

Usage:
    python3 disable_local_sharing.py
    python3 disable_local_sharing.py --keep-file      (keep settings.json as-is)
    python3 disable_local_sharing.py --delete-file    (permanently delete settings.json)
    python3 disable_local_sharing.py --dry-run        (show what would be removed)
"""

import argparse
import json
import os
import shutil
import sys

HOST_NAME = "com.blockx.settings"
APP_DIR_NAME = "BlockX"
FILE_NAME = "settings.json"

HERE = os.path.dirname(os.path.abspath(__file__))


def get_shared_settings_path():
    """Returns the path to the machine-wide shared settings file."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
        return os.path.join(base, APP_DIR_NAME, FILE_NAME)

    if sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Application Support")
        return os.path.join(base, APP_DIR_NAME, FILE_NAME)

    # Linux / Unix
    cfg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(os.path.expanduser("~"), ".config")
    return os.path.join(cfg, APP_DIR_NAME.lower(), FILE_NAME)


def get_unix_manifest_dirs():
    """Returns all potential NativeMessagingHosts directories on macOS and Linux."""
    home = os.path.expanduser("~")
    directories = []

    if sys.platform == "darwin":
        base = os.path.join(home, "Library", "Application Support")
        candidates = [
            ("Google Chrome", os.path.join(base, "Google", "Chrome", "NativeMessagingHosts")),
            ("Chrome Beta", os.path.join(base, "Google", "Chrome Beta", "NativeMessagingHosts")),
            ("Chromium", os.path.join(base, "Chromium", "NativeMessagingHosts")),
            ("Brave", os.path.join(base, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts")),
            ("Edge", os.path.join(base, "Microsoft Edge", "NativeMessagingHosts")),
            ("Vivaldi", os.path.join(base, "Vivaldi", "NativeMessagingHosts")),
        ]
        directories.extend(candidates)
    else:
        # Linux standard XDG
        cfg = os.environ.get("XDG_CONFIG_HOME") or os.path.join(home, ".config")
        candidates = [
            ("Google Chrome", os.path.join(cfg, "google-chrome", "NativeMessagingHosts")),
            ("Chrome Beta", os.path.join(cfg, "google-chrome-beta", "NativeMessagingHosts")),
            ("Chromium", os.path.join(cfg, "chromium", "NativeMessagingHosts")),
            ("Brave", os.path.join(cfg, "BraveSoftware", "Brave-Browser", "NativeMessagingHosts")),
            ("Edge", os.path.join(cfg, "microsoft-edge", "NativeMessagingHosts")),
            ("Vivaldi", os.path.join(cfg, "vivaldi", "NativeMessagingHosts")),
        ]
        directories.extend(candidates)

        # Linux Flatpaks
        flatpak = os.path.join(home, ".var", "app")
        flatpak_candidates = [
            ("Google Chrome (Flatpak)", os.path.join(flatpak, "com.google.Chrome", "config", "google-chrome", "NativeMessagingHosts")),
            ("Brave (Flatpak)", os.path.join(flatpak, "com.brave.Browser", "config", "BraveSoftware", "Brave-Browser", "NativeMessagingHosts")),
            ("Chromium (Flatpak)", os.path.join(flatpak, "org.chromium.Chromium", "config", "chromium", "NativeMessagingHosts")),
            ("Edge (Flatpak)", os.path.join(flatpak, "com.microsoft.Edge", "config", "microsoft-edge", "NativeMessagingHosts")),
        ]
        directories.extend(flatpak_candidates)

        # System-wide fallbacks
        directories.extend([
            ("System Chrome", "/etc/opt/chrome/native-messaging-hosts"),
            ("System Chromium", "/etc/chromium/native-messaging-hosts"),
        ])

    return directories


def disable_windows(dry_run=False):
    """Unregisters the host from Windows Registry across HKCU and HKLM for all Chromium browsers."""
    import winreg

    browsers = [
        ("Google Chrome", r"Software\Google\Chrome\NativeMessagingHosts"),
        ("Microsoft Edge", r"Software\Microsoft\Edge\NativeMessagingHosts"),
        ("Chromium", r"Software\Chromium\NativeMessagingHosts"),
        ("Brave", r"Software\BraveSoftware\Brave-Browser\NativeMessagingHosts"),
        ("Vivaldi", r"Software\Vivaldi\NativeMessagingHosts"),
    ]

    hives = [
        ("HKCU", winreg.HKEY_CURRENT_USER),
        ("HKLM", winreg.HKEY_LOCAL_MACHINE),
    ]

    removed_count = 0
    referenced_manifests = set()

    print("Checking Windows Registry for BlockX native messaging registrations...")

    for hive_name, hive in hives:
        for browser_label, parent_path in browsers:
            full_key_path = f"{parent_path}\\{HOST_NAME}"
            try:
                # First attempt to read the value to locate referenced manifest files
                with winreg.OpenKey(hive, full_key_path, 0, winreg.KEY_READ) as key:
                    try:
                        val, _ = winreg.QueryValueEx(key, None)
                        if val and os.path.exists(val):
                            referenced_manifests.add(val)
                    except OSError:
                        pass

                if dry_run:
                    print(f"  [DRY-RUN] Would remove {hive_name}\\{full_key_path} ({browser_label})")
                    removed_count += 1
                else:
                    winreg.DeleteKey(hive, full_key_path)
                    print(f"  [REMOVED] Registry key: {hive_name}\\{full_key_path} ({browser_label})")
                    removed_count += 1
            except FileNotFoundError:
                pass
            except PermissionError:
                print(f"  [SKIPPED] Permission denied for {hive_name}\\{full_key_path} (run as Admin if needed)")
            except OSError as e:
                print(f"  [WARNING] Error accessing {hive_name}\\{full_key_path}: {e}")

    # Also clean up referenced manifest files discovered in the registry
    for manifest_path in referenced_manifests:
        clean_up_manifest_and_wrapper(manifest_path, dry_run)

    return removed_count


def disable_unix(dry_run=False):
    """Removes native messaging manifest JSON files from macOS and Linux browser directories."""
    targets = get_unix_manifest_dirs()
    manifest_name = f"{HOST_NAME}.json"
    removed_count = 0

    print(f"Checking browser directories on {sys.platform}...")

    for label, directory in targets:
        manifest_path = os.path.join(directory, manifest_name)
        if os.path.exists(manifest_path):
            if dry_run:
                print(f"  [DRY-RUN] Would remove manifest from {label}: {manifest_path}")
                removed_count += 1
            else:
                try:
                    os.unlink(manifest_path)
                    print(f"  [REMOVED] Manifest from {label}: {manifest_path}")
                    removed_count += 1
                except OSError as e:
                    print(f"  [WARNING] Could not remove {manifest_path}: {e}")

    return removed_count


def clean_up_manifest_and_wrapper(manifest_path, dry_run=False):
    """Removes a manifest JSON file and its companion host batch/shell wrapper."""
    if not manifest_path or not os.path.exists(manifest_path):
        return

    # Try reading the manifest to locate any batch wrapper or script path
    try:
        with open(manifest_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            host_path = data.get("path")
            if host_path and os.path.exists(host_path):
                # Only delete if it's a wrapper (.bat or generated script)
                if host_path.lower().endswith(".bat") or host_path.lower().endswith(".sh"):
                    if dry_run:
                        print(f"  [DRY-RUN] Would remove launcher wrapper: {host_path}")
                    else:
                        os.unlink(host_path)
                        print(f"  [REMOVED] Launcher wrapper: {host_path}")
    except Exception:
        pass

    if dry_run:
        print(f"  [DRY-RUN] Would remove manifest file: {manifest_path}")
    else:
        try:
            os.unlink(manifest_path)
            print(f"  [REMOVED] Manifest file: {manifest_path}")
        except OSError:
            pass


def clean_local_artifacts(dry_run=False):
    """Cleans up com.blockx.settings.json and blockx_host.bat in this script's directory."""
    local_manifest = os.path.join(HERE, f"{HOST_NAME}.json")
    local_bat = os.path.join(HERE, "blockx_host.bat")

    for file_path, name in [(local_manifest, "Local manifest JSON"), (local_bat, "Local batch wrapper")]:
        if os.path.exists(file_path):
            if dry_run:
                print(f"  [DRY-RUN] Would remove {name}: {file_path}")
            else:
                try:
                    os.unlink(file_path)
                    print(f"  [REMOVED] {name}: {file_path}")
                except OSError as e:
                    print(f"  [WARNING] Could not remove {file_path}: {e}")


def handle_shared_settings_file(action="backup", dry_run=False):
    """Handles the machine-wide shared settings.json file."""
    settings_file = get_shared_settings_path()
    if not os.path.exists(settings_file):
        print("Shared settings file: not found (already inactive).")
        return

    if action == "keep":
        print(f"Shared settings file: kept as requested ({settings_file}).")
        return

    if action == "delete":
        if dry_run:
            print(f"  [DRY-RUN] Would permanently delete: {settings_file}")
        else:
            try:
                os.unlink(settings_file)
                print(f"  [REMOVED] Permanently deleted shared settings file: {settings_file}")
            except OSError as e:
                print(f"  [WARNING] Could not delete settings file: {e}")
        return

    # Default action: backup and remove active file
    bak_path = f"{settings_file}.bak"
    if dry_run:
        print(f"  [DRY-RUN] Would archive {settings_file} -> {bak_path}")
    else:
        try:
            shutil.move(settings_file, bak_path)
            print(f"  [ARCHIVED] Moved active file to backup:")
            print(f"             {bak_path}")
            print("             (Active shared file is now detached).")
        except OSError as e:
            print(f"  [WARNING] Could not move settings file: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="Turn off BlockX local machine sharing and restrict extension settings to the browser only."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Simulate the removal without modifying the registry or files."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        "--keep-file",
        action="store_true",
        help="Do not archive or delete the shared settings.json file on disk."
    )
    group.add_argument(
        "--delete-file",
        action="store_true",
        help="Permanently delete settings.json instead of archiving it to settings.json.bak."
    )

    args = parser.parse_args()

    print("=" * 68)
    print(" BlockX: Disable Local Machine Sharing")
    print("=" * 68)
    print("Operating System:", sys.platform)
    if args.dry_run:
        print("Mode: DRY RUN (no modifications will be made)\n")
    else:
        print()

    # 1. Unregister native messaging host
    if sys.platform == "win32":
        removed = disable_windows(dry_run=args.dry_run)
    else:
        removed = disable_unix(dry_run=args.dry_run)

    # 2. Clean local repository artifacts
    clean_local_artifacts(dry_run=args.dry_run)

    # 3. Handle shared settings.json
    print("\nHandling machine settings file:")
    file_action = "keep" if args.keep_file else ("delete" if args.delete_file else "backup")
    handle_shared_settings_file(action=file_action, dry_run=args.dry_run)

    print("\n" + "-" * 68)
    if removed > 0:
        print("[SUCCESS] Local machine sharing has been turned OFF.")
    else:
        print("[INFO] No active browser native registrations were found.")

    print("\nWhat this means:")
    print("  * The native host is unregistered; BlockX will no longer read/write")
    print("    to the machine-wide settings file on disk.")
    print("  * Extension settings are now 100% confined to the browser sandbox")
    print("    (chrome.storage.local for this profile, plus chrome.storage.sync).")
    print("  * Different browser profiles or other browsers will NO LONGER share")
    print("    settings with each other.")
    print("\nNEXT STEP:")
    print("  * Completely restart your browser (close all browser windows) so the")
    print("    browser unloads the native messaging host registration.")
    print("=" * 68)
    return 0


if __name__ == "__main__":
    sys.exit(main())
