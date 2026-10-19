#!/usr/bin/env python3
"""
watch.py — vigilante 24/7 de los Leones del Escogido (LIDOM).

1. statsapi.mlb.com -> juego del Escogido hoy (live/pre/final) + feed en vivo.
2. Detecta la señal real en YouTube: revisa los videos recientes de cada canal
   oficial y confirma con la watch page (ytInitialPlayerResponse → isLive).
3. Laya (decisión choice/score en un forward pass) elige la mejor señal cuando
   hay varias, y puntúa el momento del juego (0-100) + proyección para las
   gráficas de la app.
4. Escribe app/data/stream.json con las decisiones ya tomadas: la app solo
   las consume, instantánea.
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
HEADERS = {"User-Agent": UA, "Cookie": "CONSENT=YES+cb.20210101-01-p0.en+FX+100", "Accept-Language": "es-DO,es"}
STATSAPI = "https://statsapi.mlb.com/api/v1/"
ESCOGIDO_ID = 671

SOURCES = [
    ("UCF8EeDFLnGcD5-SRFS4Eyiw", "La Cueva Roja · Abriendo Sports"),
    ("UCtwRRpKOd3a62LCW8z1MwPQ", "Escogido Baseball Club"),
    ("UCodG7MOVMjh3lpV47EUTnMA", "Tigres del Licey"),
]

APP_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, "app")
OUT = os.path.join(APP_DIR, "data", "stream.json")


def fetch(url, timeout=25):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "ignore")


def get_json(url):
    try:
        return json.loads(fetch(url))
    except Exception as e:
        print(f"[warn] json {url}: {e}")
        return None


def escogido_game_range(start, end):
    """Primer juego del Escogido vs otro equipo LIDOM en el rango de fechas."""
    data = get_json(
        STATSAPI + f"schedule?sportId=17&teamId={ESCOGIDO_ID}&startDate={start}&endDate={end}"
    )
    for d in (data or {}).get("dates", []):
        for g in d.get("games", []):
            ids = {g["teams"]["away"]["team"]["id"], g["teams"]["home"]["team"]["id"]}
            if ESCOGIDO_ID in ids and all(667 <= i <= 672 for i in ids):
                return g
    return None


def escogido_game_today():
    return escogido_game_range(time.strftime("%Y-%m-%d"), time.strftime("%Y-%m-%d"))


def last_result():
    """Último juego finalizado del Escogido (últimos 21 días): texto legible."""
    end = time.strftime("%Y-%m-%d")
    start = time.strftime("%Y-%m-%d", time.localtime(time.time() - 21 * 86400))
    data = get_json(STATSAPI + f"schedule?sportId=17&teamId={ESCOGIDO_ID}&startDate={start}&endDate={end}")
    games = []
    for d in (data or {}).get("dates", []):
        for g in d.get("games", []):
            ids = {g["teams"]["away"]["team"]["id"], g["teams"]["home"]["team"]["id"]}
            if ESCOGIDO_ID in ids and g["status"].get("abstractGameState") == "Final":
                games.append(g)
    if not games:
        return "aún no hay juegos jugados esta temporada"
    g = sorted(games, key=lambda x: x.get("gameDate", ""))[-1]
    t = g["teams"]
    me = t["away"] if t["away"]["team"]["id"] == ESCOGIDO_ID else t["home"]
    opp = t["home"] if t["away"]["team"]["id"] == ESCOGIDO_ID else t["away"]
    res = "GANÓ" if me.get("isWinner") else "PERDIÓ"
    return f"{res} {me.get('score', '–')}–{opp.get('score', '–')} vs {opp['team']['name']} el {g.get('gameDate', '')[:10]}"


# ── YouTube ────────────────────────────────────────────────────────────────
def watch_info(vid):
    """{'isLive','title','author'} o None, vía ytInitialPlayerResponse."""
    try:
        html = fetch(f"https://www.youtube.com/watch?v={vid}")
    except Exception as e:
        print(f"[warn] watch {vid}: {e}")
        return None
    mr = re.search(r"ytInitialPlayerResponse\s*=\s*(\{.*?\});", html)
    if not mr:
        return None
    try:
        pr = json.loads(mr.group(1))
    except Exception:
        return None
    vd = pr.get("videoDetails") or {}
    mf = (pr.get("microformat") or {}).get("playerMicroformatRenderer") or {}
    return {
        "videoId": vid,
        "isLive": bool(vd.get("isLive")) or mf.get("liveBroadcastContent") == "live",
        "title": (vd.get("title") or "").strip(),
        "author": vd.get("author", ""),
    }


def channel_live_candidates(channel_id, max_ids=4):
    html = fetch(f"https://www.youtube.com/channel/{channel_id}/live")
    ids = list(dict.fromkeys(re.findall(r'"videoId":"([\w-]{11})"', html)))
    return ids[:max_ids]


def find_live_signals():
    """[senal] en cascada: cada canal oficial; primer video live confirmado."""
    signals = []
    for cid, name in SOURCES:
        try:
            candidates = channel_live_candidates(cid)
        except Exception as e:
            print(f"[warn] canal {cid}: {e}")
            continue
        for vid in candidates:
            info = watch_info(vid)
            if info and info["isLive"]:
                signals.append({"channelId": cid, "channelName": name, **info})
                break
        if len(signals) >= 2:
            break
    return signals


# ── Laya ──────────────────────────────────────────────────────────────────
_laya_router = None

def laya_pick(state, questions):
    """{'answers': {...}} o None si Laya no está disponible."""
    global _laya_router
    if _laya_router is None:
        try:
            from laya import Router
            _laya_router = Router()
            print("[laya] router listo")
        except Exception as e:
            print(f"[warn] laya no disponible ({e}); continúo solo con lógica técnica")
            _laya_router = False
    if not _laya_router:
        return None
    try:
        res = _laya_router.predict(state, questions)
        routing = res.get("routing", {}) or {}
        print(f"[laya] model={routing.get('model')}")
        return res.get("answers")
    except Exception as e:
        print(f"[warn] laya predict: {e}")
        _laya_router = None
    return None


def laya_pick_signal(signals, game):
    if len(signals) < 2:
        return None
    options = json.dumps(
        [{"i": i, "canal": s["channelName"], "video": s["title"][:90]} for i, s in enumerate(signals)],
        ensure_ascii=False)
    answers = laya_pick(
        {
            "context": "Transmisiones en vivo disponibles ahora del juego de Leones del Escogido, liga dominicana LIDOM, en español.",
            "fuente": signals[0]["channelName"],
            "options": options,
        },
        {"senal": {
            "type": "choice",
            "instructions": "¿Qué transmisión es la señal oficial en vivo más estable y con mejor calidad para el juego del Escogido hoy? Escoge un índice.",
            "criteria": {str(i): f"{s['channelName']} — {s['title'][:90]}" for i, s in enumerate(signals)},
        }},
    )
    if not answers:
        return None
    a = answers.get("senal") or {}
    ch = str(a.get("choice", ""))
    print(f"[laya] señal choice={ch} confidence={a.get('confidence')}")
    if ch.isdigit() and int(ch) < len(signals):
        return int(ch)
    return None


def laya_momento(game, feed):
    ls = (feed or {}).get("liveData", {}).get("linescore", {}) or {}
    away_n, home_n = game["teams"]["away"]["team"]["name"], game["teams"]["home"]["team"]["name"]
    is_leo_away = game["teams"]["away"]["team"].get("id") == ESCOGIDO_ID
    a_runs = (ls.get("teams", {}).get("away", {}) or {}).get("runs", 0) or 0
    h_runs = (ls.get("teams", {}).get("home", {}) or {}).get("runs", 0) or 0
    a_hits = (ls.get("teams", {}).get("away", {}) or {}).get("hits", 0) or 0
    h_hits = (ls.get("teams", {}).get("home", {}) or {}).get("hits", 0) or 0
    outs = ls.get("outs", 0) or 0
    inning = ls.get("currentInning", 0) or 0
    half = "arriba" if ls.get("inningHalf") == "top" else ("abajo" if ls.get("inningHalf") == "bottom" else "")
    batter = (ls.get("offense", {}).get("batter", {}) or {}).get("fullName", "desconocido")
    leo_runs, opp_runs = (a_runs, h_runs) if is_leo_away else (h_runs, a_runs)
    leo_hits, opp_hits = (a_hits, h_hits) if is_leo_away else (h_hits, a_hits)
    state = {
        "estado": (game.get("status", {}) or {}).get("detailedState", ""),
        "marcador": f"{away_n} (visitante) {a_runs} — {h_runs} {home_n} (local)",
        "detalle": (
            f"Leones del Escogido: {leo_runs} carreras, {leo_hits} hits. "
            f"Rival: {opp_runs} carreras, {opp_hits} hits. "
            f"Inning {inning} ({half}), {outs} outs, al bate {batter}. "
            "Liga dominicana LIDOM."
        ),
    }
    answers = laya_pick(state, {
        "momento": {
            "type": "score",
            "instructions": "¿Qué tan dominante está el Leones del Escogido en este instante del juego? Escoge el nivel que mejor describa el estado actual.",
            "criteria": [
                "El rival está dominando completamente el juego",
                "El rival está adelante pero el Escogido compite",
                "El juego está parejo, sin ventaja clara",
                "El Escogido está adelante y controla el ritmo",
                "El Escogido está aplastando al rival",
            ],
        },
        "proyeccion": {
            "type": "choice",
            "instructions": "¿Cómo terminará probablemente el juego desde este punto? Escoge la opción con probabilidad más alta.",
            "criteria": {
                "victoria": "El Escogido adelante y controla el juego",
                "candela": "Marcador parecido y sin ventaja clara",
                "derrota": "El rival adelante en el marcador",
            },
        },
    })
    if not answers:
        return None
    info = {}
    m = answers.get("momento") or {}
    val = m.get("score", m.get("value", m.get("choice")))
    if isinstance(val, (int, float)):
        info["momento"] = round(val * 25 if 0 <= val <= 4 else val)   # 5 niveles → 0-100
    elif isinstance(val, str):
        try:
            v = float(val)
            info["momento"] = round(v * 25 if 0 <= v <= 4 else v)
        except Exception:
            pass
    p = answers.get("proyeccion") or {}
    ch = p.get("choice")
    if ch:
        entry = {"choice": ch}
        for key in ("probabilities", "probability", "confidence"):
            if p.get(key) is not None:
                entry[key] = p.get(key)
        info["proyeccion"] = entry
    print(f"[laya] momento/proyeccion: {json.dumps(info, ensure_ascii=False)[:300]}")
    return info or None


def laya_previa(game=None):
    """Análisis de Laya cuando NO hay juego en vivo: proyección del próximo juego."""
    if game:
        t = game["teams"]
        me = t["away"] if t["away"]["team"]["id"] == ESCOGIDO_ID else t["home"]
        opp = t["home"] if t["away"]["team"]["id"] == ESCOGIDO_ID else t["away"]
        rival = opp["team"]["name"]
        hora = (game.get("gameDate") or "")[:16].replace("T", " ") + " UTC"
        donde = "en casa" if me != t["away"] else "de visitante"
        contexto = f"Juego programado del Escogido {donde} contra {rival} a las {hora}."
    else:
        rival = "rival LIDOM por definir"
        contexto = "No hay juego del Escogido hoy; el próximo juego está por venir."
    state = {
        "estado": "Pre-juego",
        "marcador": "—",
        "detalle": f"{contexto} Último resultado del Escogido: {last_result()}. Liga dominicana LIDOM 2026-27.",
    }
    answers = laya_pick(state, {
        "proyeccion": {
            "type": "choice",
            "instructions": "¿Cómo ve la casa el próximo juego del Leones del Escogido con lo que ha mostrado hasta ahora? Escoge la opción con probabilidad más alta.",
            "criteria": {
                "victoria": "El Escogido llega mejor y es favorito para ganar",
                "candela": "El juego se ve parejo y apretado",
                "derrota": "El rival llega mejor y el Escogido_arranca en desventaja",
            },
        },
    })
    if not answers:
        return None
    p = answers.get("proyeccion") or {}
    ch = p.get("choice")
    if not ch:
        return None
    info = {"modo": "pre", "proyeccion": {"choice": ch}}
    probs = p.get("probabilities")
    if probs:
        info["proyeccion"]["probabilities"] = probs
    print(f"[laya] previa: {json.dumps(info, ensure_ascii=False)[:300]}")
    return info


def main():
    game = escogido_game_today()
    info = {"ts": int(time.time() * 1000), "checked": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}

    if not game:
        info["game"] = None
        info["live"] = False
        info["source"] = None
        info["alternates"] = []
        start = time.strftime("%Y-%m-%d")
        end = time.strftime("%Y-%m-%d", time.localtime(time.time() + 10 * 86400))
        nxt = escogido_game_range(start, end)
        info["laya"] = laya_previa(nxt if nxt else None)
        write(info)
        return 0

    status = game.get("status", {}) or {}
    abstract = status.get("abstractGameState", "")
    info["game"] = {
        "gamePk": game.get("gamePk"),
        "status": status.get("detailedState", ""),
        "abstract": abstract,
        "away": game["teams"]["away"]["team"]["name"],
        "home": game["teams"]["home"]["team"]["name"],
        "startTime": game.get("gameDate"),
    }

    source, alternates = None, []
    if abstract in ("Live", "Pre", "Preview"):
        signals = find_live_signals()
        if signals:
            idx = laya_pick_signal(signals, game)
            source = signals[idx if idx else 0]["channelName"] and signals[idx if idx is not None else 0]
            alternates = [{k: s[k] for k in ("videoId", "channelName", "title")} for s in signals[1:]]

    info["live"] = bool(source) and abstract in ("Live", "Pre", "Preview")
    info["source"] = source
    info["alternates"] = alternates[:4]

    if abstract == "Live":
        feed = get_json("https://statsapi.mlb.com/api/v1.1/game/" + str(game["gamePk"]) + "/feed/live")
        laya = laya_momento(game, feed)
        if laya:
            laya["modo"] = "live"
        info["laya"] = laya
    else:
        # juego Pre/Final/Cancelado hoy: Laya mantiene activa la proyección
        info["laya"] = laya_previa(game if abstract != "Final" else None)

    write(info)
    return 0


def write(info):
    os.makedirs(os.path.join(APP_DIR, "data"), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(info, f, ensure_ascii=False, indent=1)
    summary = {"ts": info.get("ts"), "live": info.get("live"),
               "source": (info.get("source") or {}).get("channelName"), "laya": info.get("laya")}
    print("[out] " + json.dumps(summary, ensure_ascii=False)[:500])


def self_test():
    st = {"estado": "Scheduled", "marcador": "Leones del Escogido 0 — 0 Estrellas Orientales",
          "detalle": "Juego programado, marcador en ceros, inning 1 arriba, 0 outs. Liga dominicana LIDOM."}
    qs = {
        "estrategia": {
            "type": "choice",
            "instructions": "En un juego del Escogido a punto de empezar, ¿qué enfoque de apertura recomienda la casa?",
            "criteria": {"proactiva": "Bateadores agresivos al inicio del juego", "conservadora": "Bateadores pacientes y disciplina en el plato"},
        },
        "momento": {
            "type": "score",
            "instructions": "¿Qué tan fuertes va el Escogido en el ambiente del juego? Elige el nivel que mejor describa el año actual.",
            "criteria": [
                "El rival está dominando completamente el juego",
                "El rival está adelante pero el Escogido compite",
                "El juego está parejo, sin ventaja clara",
                "El Escogido está adelante y controla el ritmo",
                "El Escogido está aplastando al rival",
            ],
        },
    }
    global _laya_router
    try:
        from laya import Router
        _laya_router = Router()
        res = _laya_router.predict(st, qs)
        print(f"[test] RAW: {json.dumps(res, ensure_ascii=False)[:900]}")
    except Exception as e:
        print(f"[test] FAIL: {e}")


if __name__ == "__main__":
    if os.environ.get("LAYA_TEST"):
        self_test()
        sys.exit(0)
    sys.exit(main())
