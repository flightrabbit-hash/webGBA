(() => {
  if (!matchMedia("(pointer: coarse) and (hover: none)").matches || Math.min(screen.width, screen.height) > 600) return;
  const BASE = ["meadow", "home", "sunset"];
  const KEY = "webgba.splashRecent";
  const now = new Date();
  const hour = now.getHours();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const weekend = now.getDay() === 0 || now.getDay() === 6;
  const season = ["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][month - 1];
  const summer = season === "summer";
  const when = (yes, list) => (yes ? list : []);
  let slot;
  let list;
  if (!weekend && (hour === 17 || hour === 18 || (hour === 19 && now.getMinutes() === 0))) [slot, list] = ["home", [["home", 1]]];
  else if (month === 12 && date >= 18 && date <= 25 && (hour >= 19 || hour < 4)) [slot, list] = ["christmas", [["christmas", 1]]];
  else if (month === 10 && date >= 25 && (hour >= 23 || hour < 4)) [slot, list] = ["halloween", [["halloween", 1]]];
  else if (month === 4 && date <= 14 && hour >= 4 && hour < 17) [slot, list] = ["cherry", [["spring-cherry", 1]]];
  else if (hour >= 4 && hour < 9)
    [slot, list] = ["dawn", [["meadow", 1], ["bamboo", 1], ...{ spring: [["spring-cherry", 2], ["tulip", 2]], summer: [["sunflower", 2]], autumn: [["autumn-maple", 2]], winter: [["winter-snow", 2]] }[season]]];
  else if (hour >= 9 && hour < 17)
    [slot, list] = ["day", [["market", 1], ["temple", 1], ["desert", 1], ["cloud-path", 0.5], ["candy", 0.5], ...when(summer, [["summer-beach", 2]]), ...when(month === 6, [["hydrangea", 2]])]];
  else if (hour >= 17 && hour < 19) [slot, list] = ["dusk", [["sunset", 1], ["market", 1], ["rain-alley", 1], ...when(summer, [["festival", 2]])]];
  else if (hour >= 19 && hour < 23)
    [slot, list] = ["evening", [["library", 1], ["train", 1], ["castle", 1], ["greenhouse", 1], ["rain-alley", 1], ...when(weekend, [["home", 1]]), ...when(season === "winter", [["christmas", 2]])]];
  else [slot, list] = ["night", [["starry-hill", 1], ["sunset", 1], ["crystal-cave", 1], ["neon-street", 1], ["space", 0.5], ["underwater", 0.5], ...when(summer, [["festival", 2]])]];

  let recent = [];
  try {
    recent = JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {}
  if (!Array.isArray(recent)) recent = [];
  const skip = recent.slice(list.length > 3 ? -3 : -1);
  const kept = list.filter(([id]) => !skip.includes(id));
  const pool = kept.length ? kept : list;
  const choose = (from) => {
    let left = Math.random() * from.reduce((sum, [, weight]) => sum + weight, 0);
    for (const [id, weight] of from) if ((left -= weight) < 0) return id;
    return from[from.length - 1][0];
  };
  const remember = (id) => {
    try {
      localStorage.setItem(KEY, JSON.stringify([...recent.filter((one) => one !== id), id].slice(-3)));
    } catch {}
  };
  const load = (name) => {
    const image = new Image();
    image.src = `/splash/${name}.png`;
    return image.decode().then(() => image);
  };
  const stored = !("serviceWorker" in navigator) || Boolean(navigator.serviceWorker.controller);
  const has = ([id]) => stored || BASE.includes(id);

  const first = choose(pool);
  const near = pool.filter(has);
  const any = list.filter(has);
  const variant = has([first]) ? first : near.length ? choose(near) : any.length ? choose(any) : "meadow";
  const base = BASE.includes(variant);
  const cat = load("cat");
  const text = load("text");
  const images = (name) => Promise.all([cat, load(name), text]).then((loaded) => [name, loaded]);
  const ready = (base ? images(variant) : images(variant).catch(() => images("meadow"))).then((result) => (remember(result[0]), result));
  ready.catch(() => {});
  window.webgbaSplashPlan = { variant: base ? variant : null, slot, list, ready };
})();
