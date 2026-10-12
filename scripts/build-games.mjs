// Builds games.json: the next 14 days of games for every team HomeGlow knows,
// named the way the app names them ("Chicago Football"). Runs on GitHub Actions
// twice a day; the app only ever reads the finished file, never the sports API.
// Needs BALLDONTLIE_KEY in the environment (a repository secret).

import { writeFile } from "node:fs/promises";

const KEY = process.env.BALLDONTLIE_KEY;
if (!KEY) { console.error("BALLDONTLIE_KEY is missing"); process.exit(1); }
const BASE = "https://api.balldontlie.io";
const DAYS = 14;
const PAUSE_MS = 13_000;   // free tier allows 5 calls a minute

// API abbreviation (or nickname for hockey) → HomeGlow's team look name.
const NFL = {
  ARI: "Arizona", ATL: "Atlanta", BAL: "Baltimore", BUF: "Buffalo", CAR: "Carolina", CHI: "Chicago",
  CIN: "Cincinnati", CLE: "Cleveland", DAL: "Dallas", DEN: "Denver", DET: "Detroit", GB: "Green Bay",
  HOU: "Houston", IND: "Indianapolis", JAX: "Jacksonville", KC: "Kansas City", LV: "Las Vegas",
  LAR: "Los Angeles Football (blue & gold)", LAC: "Los Angeles Football (powder blue)", MIA: "Miami",
  MIN: "Minnesota", NE: "New England", NO: "New Orleans", NYG: "New York Football (blue)",
  NYJ: "New York Football (green)", PHI: "Philadelphia", PIT: "Pittsburgh", SF: "San Francisco",
  SEA: "Seattle", TB: "Tampa Bay", TEN: "Tennessee", WSH: "Washington", WAS: "Washington",
};
const NBA = {
  ATL: "Atlanta", BOS: "Boston", BKN: "Brooklyn", CHA: "Charlotte", CHI: "Chicago", CLE: "Cleveland",
  DAL: "Dallas", DEN: "Denver", DET: "Detroit", GSW: "Golden State", HOU: "Houston", IND: "Indiana",
  LAC: "Los Angeles Basketball (red & blue)", LAL: "Los Angeles Basketball (purple & gold)", MEM: "Memphis",
  MIA: "Miami", MIL: "Milwaukee", MIN: "Minnesota", NOP: "New Orleans", NYK: "New York", OKC: "Oklahoma City",
  ORL: "Orlando", PHI: "Philadelphia", PHX: "Phoenix", POR: "Portland", SAC: "Sacramento", SAS: "San Antonio",
  TOR: "Toronto", UTA: "Utah", WAS: "Washington",
};
const MLB = {
  ARI: "Arizona", OAK: "Sacramento", ATH: "Sacramento", ATL: "Atlanta", BAL: "Baltimore", BOS: "Boston",
  CHC: "Chicago Baseball (North Side)", CHW: "Chicago Baseball (South Side)", CWS: "Chicago Baseball (South Side)",
  CIN: "Cincinnati", CLE: "Cleveland", COL: "Colorado", DET: "Detroit", HOU: "Houston", KC: "Kansas City",
  LAA: "Anaheim", LAD: "Los Angeles", MIA: "Miami", MIL: "Milwaukee", MIN: "Minnesota",
  NYM: "New York Baseball (blue & orange)", NYY: "New York Baseball (navy)", PHI: "Philadelphia",
  PIT: "Pittsburgh", SD: "San Diego", SF: "San Francisco", SEA: "Seattle", STL: "St. Louis", TB: "Tampa Bay",
  TEX: "Texas", TOR: "Toronto", WSH: "Washington", WAS: "Washington",
};
const NHL = {   // by nickname, since the API's hockey teams include old franchises
  Ducks: "Anaheim", Bruins: "Boston", Sabres: "Buffalo", Flames: "Calgary", Hurricanes: "Carolina",
  Blackhawks: "Chicago", Avalanche: "Colorado", "Blue Jackets": "Columbus", Stars: "Dallas", "Red Wings": "Detroit",
  Oilers: "Edmonton", Panthers: "Florida", Kings: "Los Angeles", Wild: "Minnesota", Canadiens: "Montreal",
  Predators: "Nashville", Devils: "New Jersey", Islanders: "Long Island", Rangers: "New York", Senators: "Ottawa",
  Flyers: "Philadelphia", Penguins: "Pittsburgh", Sharks: "San Jose", Kraken: "Seattle", Blues: "St. Louis",
  Lightning: "Tampa Bay", "Maple Leafs": "Toronto", Mammoth: "Utah", Canucks: "Vancouver",
  "Golden Knights": "Vegas", Capitals: "Washington", Jets: "Winnipeg",
};

const full = (name, sport) => name.includes("(") ? name : `${name} ${sport}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function dates() {
  const out = [];
  const now = new Date();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + i));
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

let calls = 0;
async function getAll(path) {
  const all = [];
  let cursor;
  do {
    const params = new URLSearchParams();
    for (const d of dates()) params.append("dates[]", d);
    params.set("per_page", "100");
    if (cursor) params.set("cursor", String(cursor));
    if (calls++ > 0) await sleep(PAUSE_MS);
    const res = await fetch(`${BASE}${path}?${params}`, { headers: { Authorization: KEY } });
    if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    all.push(...(body.data ?? []));
    cursor = body.meta?.next_cursor;
  } while (cursor);
  return all;
}

const leagues = [
  { sport: "Football", path: "/nfl/v1/games",
    teams: (g) => [g.home_team?.abbreviation, g.visitor_team?.abbreviation], map: NFL, by: "abbr",
    start: (g) => g.date },
  { sport: "Basketball", path: "/v1/games",
    teams: (g) => [g.home_team?.abbreviation, g.visitor_team?.abbreviation], map: NBA, by: "abbr",
    start: (g) => g.datetime ?? g.status },
  { sport: "Baseball", path: "/mlb/v1/games",
    teams: (g) => [g.home_team?.abbreviation, g.away_team?.abbreviation], map: MLB, by: "abbr",
    start: (g) => g.date },
  { sport: "Hockey", path: "/nhl/v1/games",
    teams: (g) => [g.home_team?.full_name ?? g.home_team?.name, g.away_team?.full_name ?? g.away_team?.name ?? g.visitor_team?.full_name],
    map: NHL, by: "nickname", start: (g) => g.start_time_utc ?? g.date },
];

function lookup(league, key) {
  if (!key) return null;
  if (league.by === "abbr") return league.map[key] ? full(league.map[key], league.sport) : null;
  const nick = Object.keys(league.map).find((n) => key.endsWith(n));
  return nick ? full(league.map[nick], league.sport) : null;
}

const games = [];
const notes = [];
for (const league of leagues) {
  try {
    const raw = await getAll(league.path);
    for (const g of raw) {
      const [home, away] = league.teams(g).map((k) => lookup(league, k));
      const start = league.start(g);
      if (!home || !away || !start) continue;
      const t = new Date(start);
      if (isNaN(t)) continue;
      games.push({ l: league.sport, t: t.toISOString(), h: home, a: away, p: !!g.postseason });
    }
    notes.push(`${league.sport}: ${raw.length}`);
  } catch (e) {
    notes.push(`${league.sport}: skipped (${String(e.message).slice(0, 120)})`);
  }
}
games.sort((x, y) => x.t.localeCompare(y.t));
await writeFile("games.json", JSON.stringify({ updated: new Date().toISOString(), days: DAYS, games }));
console.log(`Wrote ${games.length} games. ${notes.join("; ")}. API calls: ${calls}`);
