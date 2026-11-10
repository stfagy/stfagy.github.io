#!/usr/bin/env python3
"""Migration contrôlée des ressources GitHub Pages de MUdM vers mudm/.

À lancer une seule fois sur STF-DELL avec sudo, hors collecte quotidienne.
Ne lit que les identifiants déjà protégés sur le serveur ; ne les affiche jamais.
"""
from __future__ import annotations

import ast
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

SITE = Path("/srv/mudm/site")
COLLECTOR = Path("/srv/mudm/collector")
SCRIPT = COLLECTOR / "linux/run_daily.py"
LOGS = Path("/srv/mudm/logs")
SECRETS = Path("/etc/mudm/secrets.json")
OLD = "La minute utile du musicien"
NEW = "mudm"
REPO = "https://github.com/stfagy/stfagy.github.io.git"
BEFORE_URL = "https://stfagy.github.io/La%20minute%20utile%20du%20musicien/catalogue_videos.json"
AFTER_URL = "https://stfagy.github.io/mudm/catalogue_videos.json"
STUB_FILES = {
    "index.html", "videos_pdf.html", "pdfs_videos.html",
    "visualizer.html", "impro_blues.html", "intervalles.html",
}


def command(*args: str, user: str | None = None, env=None) -> str:
    argv = list(args)
    if user:
        argv = ["runuser", "-u", user, "--", *argv]
    result = subprocess.run(argv, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, env=env, check=False)
    if result.returncode:
        raise RuntimeError(f"{args[0]} : code {result.returncode} : {(result.stdout or '')[-600:]}")
    return (result.stdout or "").strip()


def git(*args: str, env=None) -> str:
    return command("git", "-C", str(SITE), *args, user="mudm", env=env)


def service_active(name: str) -> bool:
    return subprocess.run(["systemctl", "is-active", "--quiet", name], check=False).returncode == 0


def check_catalogues() -> None:
    for name in ("catalogue_videos.json", "catalogue_pdfs.json"):
        target = SITE / NEW / name
        if not target.is_file() or target.stat().st_size < 1000:
            raise RuntimeError(f"Catalogue absent après déplacement : {target}")
        obj = json.loads(target.read_text(encoding="utf-8"))
        if obj.get("total", 0) < 100 or not obj.get("items"):
            raise RuntimeError(f"Catalogue incomplet : {name}")


def check_collector() -> None:
    env = {
        **os.environ,
        "MUDM_SECRETS_FILE": str(SECRETS),
        "MUDM_SITE_REPO": str(SITE),
        "MUDM_LOG_DIR": str(LOGS),
    }
    print(command(str(COLLECTOR / ".venv/bin/python"), str(SCRIPT), "--check",
                  user="mudm", env=env), flush=True)


def replace_script(original: str) -> str:
    before_rel = 'REL = "La minute utile du musicien"'
    after_rel = 'REL = "mudm"'
    if original.count(before_rel) != 1 or original.count(BEFORE_URL) != 1:
        raise RuntimeError("Références inattendues dans le script local : migration annulée")
    result = original.replace(before_rel, after_rel).replace(BEFORE_URL, AFTER_URL)
    ast.parse(result, filename=str(SCRIPT))
    return result


def atomic_replace(path: Path, content: str) -> None:
    meta = path.stat()
    fd, name = tempfile.mkstemp(prefix=".mudm-", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, stat.S_IMODE(meta.st_mode))
        os.chown(name, meta.st_uid, meta.st_gid)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def main() -> int:
    if os.geteuid() != 0:
        raise RuntimeError("Exécuter avec sudo depuis STF-DELL")
    for path in (SITE / ".git", SCRIPT, SECRETS, SITE / OLD, SITE / NEW):
        if not path.exists():
            raise RuntimeError(f"Précondition absente : {path}")
    if command("id", "-u", "mudm") == "":
        raise RuntimeError("Compte mudm introuvable")
    if service_active("mudm-daily.service"):
        raise RuntimeError("La collecte est en cours. Réessayer après sa fin, sans l'interrompre.")
    if git("branch", "--show-current") != "main":
        raise RuntimeError("Branche de publication différente de main")
    if git("remote", "get-url", "origin") != REPO:
        raise RuntimeError("URL GitHub de publication inattendue")
    if git("status", "--porcelain"):
        raise RuntimeError("Dépôt du site modifié : intervention manuelle nécessaire")

    print("Synchronisation du site (sans modification des données métier)...", flush=True)
    git("pull", "--ff-only", "origin", "main")
    if git("status", "--porcelain"):
        raise RuntimeError("Dépôt du site modifié après pull")
    stub = SITE / NEW
    if {p.name for p in stub.iterdir()} != STUB_FILES:
        raise RuntimeError("Le contenu de mudm/ a changé : arrêt préventif")
    original = SCRIPT.read_text(encoding="utf-8")
    updated = replace_script(original)
    check_collector()

    timer_was_active = service_active("mudm-daily.timer")
    command("systemctl", "stop", "mudm-daily.timer")
    if service_active("mudm-daily.service"):
        if timer_was_active:
            command("systemctl", "start", "mudm-daily.timer")
        raise RuntimeError("Le service est devenu actif : migration annulée")
    print("Minuteur suspendu pendant le déplacement.", flush=True)

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%SZ")
    LOGS.mkdir(parents=True, exist_ok=True)
    backup = LOGS / f"run_daily.before-mudm-{stamp}.py"
    backup.write_text(original, encoding="utf-8")
    backup.chmod(0o600)
    print(f"Sauvegarde du script : {backup}", flush=True)

    # En cas d'échec après ce point, le minuteur reste arrêté (sécurité).
    git("rm", "-r", "--", NEW)
    git("mv", "--", OLD, NEW)
    atomic_replace(SCRIPT, updated)
    check_catalogues()
    git("diff", "--cached", "--check")
    print("Répertoire déplacé et script local corrigé.", flush=True)

    sha_before = git("rev-parse", "HEAD")
    git("-c", "user.name=stfagy",
        "-c", "user.email=112502606+stfagy@users.noreply.github.com",
        "commit", "-m", "Renomme le dossier GitHub Pages en mudm")
    sha = git("rev-parse", "HEAD")
    print(f"Commit local : {sha}, parent : {sha_before}", flush=True)

    secrets = json.loads(SECRETS.read_text(encoding="utf-8"))
    token = secrets.get("GITHUB_TOKEN")
    if not token:
        raise RuntimeError("Jeton de publication GitHub introuvable ; minuteur maintenu arrêté")
    git_env = {
        **os.environ,
        "GITHUB_TOKEN": token,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": str(COLLECTOR / "linux/git-askpass.sh"),
    }
    git("-c", "credential.helper=", "push", "origin", "main", env=git_env)
    remote = git("-c", "credential.helper=", "ls-remote", "origin",
                 "refs/heads/main", env=git_env)
    if not remote.startswith(sha + "\t"):
        raise RuntimeError("Push GitHub non confirmé ; minuteur maintenu arrêté")
    if git("status", "--porcelain"):
        raise RuntimeError("Dépôt local non propre après la migration")
    check_collector()

    if timer_was_active:
        command("systemctl", "start", "mudm-daily.timer")
        if not service_active("mudm-daily.timer"):
            raise RuntimeError("Impossible de redémarrer le timer quotidien")
    print(f"MIGRATION MUDM VALIDÉE : {sha}", flush=True)
    print("Le déploiement GitHub Pages peut suivre avec un léger décalage.", flush=True)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"ÉCHEC MIGRATION : {type(exc).__name__}: {exc}", file=sys.stderr, flush=True)
        print("Vérifier l'état du timer et du dépôt avant toute relance.", file=sys.stderr)
        sys.exit(1)
