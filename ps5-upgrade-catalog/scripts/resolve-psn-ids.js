/*
 * Resolve PlayStation Store ids for the catalog.
 *
 * The store's search page is rendered in the browser, so it cannot be read
 * from a server. This runs in your own browser instead, where the page is
 * already rendered and same-origin, and writes out the ids it finds.
 *
 * HOW TO RUN
 *   1. Open https://store.playstation.com/en-us/pages/browse in Chrome.
 *   2. Open DevTools (F12 or Cmd+Option+I) and click the Console tab.
 *   3. Paste this whole file in and press Enter.
 *   4. Leave the tab open and in the foreground. It takes roughly 10 minutes.
 *   5. It downloads psn-ids.json when it finishes. Send me that file.
 *
 * It only reads search results. It does not sign in, buy, or change anything.
 * If you close the tab early, whatever it found so far is still downloaded.
 */
(async () => {
  const GAMES = [
    {
      "id": "outer-wilds",
      "title": "Outer Wilds"
    },
    {
      "id": "disco-elysium",
      "title": "Disco Elysium: The Final Cut"
    },
    {
      "id": "no-mans-sky",
      "title": "No Man's Sky"
    },
    {
      "id": "subnautica",
      "title": "Subnautica"
    },
    {
      "id": "deaths-door",
      "title": "Death's Door"
    },
    {
      "id": "tunic",
      "title": "Tunic"
    },
    {
      "id": "stray",
      "title": "Stray"
    },
    {
      "id": "sea-of-stars",
      "title": "Sea of Stars"
    },
    {
      "id": "the-pathless",
      "title": "The Pathless"
    },
    {
      "id": "solar-ash",
      "title": "Solar Ash"
    },
    {
      "id": "horizon-forbidden-west",
      "title": "Horizon Forbidden West"
    },
    {
      "id": "elden-ring",
      "title": "Elden Ring"
    },
    {
      "id": "deliver-us-mars",
      "title": "Deliver Us Mars"
    },
    {
      "id": "season-letter",
      "title": "Season: A letter to the future"
    },
    {
      "id": "eastshade",
      "title": "Eastshade"
    },
    {
      "id": "firewatch",
      "title": "Firewatch"
    },
    {
      "id": "alba-wildlife",
      "title": "Alba: A Wildlife Adventure"
    },
    {
      "id": "life-is-strange-true-colors",
      "title": "Life is Strange: True Colors"
    },
    {
      "id": "a-short-hike",
      "title": "A Short Hike"
    },
    {
      "id": "lake",
      "title": "Lake"
    },
    {
      "id": "sandrock",
      "title": "My Time at Sandrock"
    },
    {
      "id": "paleo-pines",
      "title": "Paleo Pines"
    },
    {
      "id": "bugsnax",
      "title": "Bugsnax"
    },
    {
      "id": "dreamlight-valley",
      "title": "Disney Dreamlight Valley"
    },
    {
      "id": "cult-of-the-lamb",
      "title": "Cult of the Lamb"
    },
    {
      "id": "roots-of-pacha",
      "title": "Roots of Pacha"
    },
    {
      "id": "spiritfarer",
      "title": "Spiritfarer: Farewell Edition"
    },
    {
      "id": "gris",
      "title": "Gris"
    },
    {
      "id": "toem",
      "title": "TOEM"
    },
    {
      "id": "dredge",
      "title": "Dredge"
    },
    {
      "id": "oxenfree-2",
      "title": "Oxenfree II: Lost Signals"
    },
    {
      "id": "night-in-the-woods",
      "title": "Night in the Woods"
    },
    {
      "id": "roki",
      "title": "Röki"
    },
    {
      "id": "kena",
      "title": "Kena: Bridge of Spirits"
    },
    {
      "id": "chicory",
      "title": "Chicory: A Colorful Tale"
    },
    {
      "id": "cassette-beasts",
      "title": "Cassette Beasts"
    },
    {
      "id": "dave-the-diver",
      "title": "Dave the Diver"
    },
    {
      "id": "tinykin",
      "title": "Tinykin"
    },
    {
      "id": "balatro",
      "title": "Balatro"
    },
    {
      "id": "teenage-exocolonist",
      "title": "I Was a Teenage Exocolonist"
    },
    {
      "id": "tchia",
      "title": "Tchia"
    },
    {
      "id": "hollow-knight",
      "title": "Hollow Knight"
    },
    {
      "id": "ender-lilies",
      "title": "Ender Lilies: Quietus of the Knights"
    },
    {
      "id": "blasphemous",
      "title": "Blasphemous"
    },
    {
      "id": "dead-cells",
      "title": "Dead Cells"
    },
    {
      "id": "guacamelee-2",
      "title": "Guacamelee! 2"
    },
    {
      "id": "momodora",
      "title": "Momodora: Reverie Under the Moonlight"
    },
    {
      "id": "salt-and-sanctuary",
      "title": "Salt and Sanctuary"
    },
    {
      "id": "deedlit-wonder-labyrinth",
      "title": "Record of Lodoss War: Deedlit in Wonder Labyrinth"
    },
    {
      "id": "afterimage",
      "title": "Afterimage"
    },
    {
      "id": "grime",
      "title": "GRIME"
    },
    {
      "id": "ghost-song",
      "title": "Ghost Song"
    },
    {
      "id": "haiku-the-robot",
      "title": "Haiku, the Robot"
    },
    {
      "id": "infernax",
      "title": "Infernax"
    },
    {
      "id": "astalon",
      "title": "Astalon: Tears of the Earth"
    },
    {
      "id": "rain-world",
      "title": "Rain World"
    },
    {
      "id": "carrion",
      "title": "Carrion"
    },
    {
      "id": "prince-of-persia-lost-crown",
      "title": "Prince of Persia: The Lost Crown"
    },
    {
      "id": "bloodstained",
      "title": "Bloodstained: Ritual of the Night"
    },
    {
      "id": "unsighted",
      "title": "Unsighted"
    },
    {
      "id": "vernal-edge",
      "title": "Vernal Edge"
    },
    {
      "id": "ultros",
      "title": "Ultros"
    },
    {
      "id": "slay-the-spire",
      "title": "Slay the Spire"
    },
    {
      "id": "inscryption",
      "title": "Inscryption"
    },
    {
      "id": "roguebook",
      "title": "Roguebook"
    },
    {
      "id": "griftlands",
      "title": "Griftlands"
    },
    {
      "id": "fights-in-tight-spaces",
      "title": "Fights in Tight Spaces"
    },
    {
      "id": "astrea-six-sided-oracles",
      "title": "Astrea: Six-Sided Oracles"
    },
    {
      "id": "monster-sanctuary",
      "title": "Monster Sanctuary"
    },
    {
      "id": "nexomon-extinction",
      "title": "Nexomon: Extinction"
    },
    {
      "id": "coromon",
      "title": "Coromon"
    },
    {
      "id": "slime-rancher",
      "title": "Slime Rancher"
    },
    {
      "id": "siralim-ultimate",
      "title": "Siralim Ultimate"
    },
    {
      "id": "stardew-valley",
      "title": "Stardew Valley"
    },
    {
      "id": "my-time-at-portia",
      "title": "My Time at Portia"
    },
    {
      "id": "potion-permit",
      "title": "Potion Permit"
    },
    {
      "id": "cozy-grove",
      "title": "Cozy Grove"
    },
    {
      "id": "garden-story",
      "title": "Garden Story"
    },
    {
      "id": "the-sims-4",
      "title": "The Sims 4"
    },
    {
      "id": "everdream-valley",
      "title": "Everdream Valley"
    },
    {
      "id": "kitaria-fables",
      "title": "Kitaria Fables"
    },
    {
      "id": "calico",
      "title": "Calico"
    },
    {
      "id": "graveyard-keeper",
      "title": "Graveyard Keeper"
    },
    {
      "id": "moonlighter",
      "title": "Moonlighter"
    },
    {
      "id": "powerwash-simulator",
      "title": "PowerWash Simulator"
    },
    {
      "id": "two-point-campus",
      "title": "Two Point Campus"
    },
    {
      "id": "islanders",
      "title": "Islanders"
    },
    {
      "id": "townscaper",
      "title": "Townscaper"
    },
    {
      "id": "celeste",
      "title": "Celeste"
    },
    {
      "id": "sackboy",
      "title": "Sackboy: A Big Adventure"
    },
    {
      "id": "little-nightmares-2",
      "title": "Little Nightmares II"
    },
    {
      "id": "little-nightmares",
      "title": "Little Nightmares"
    },
    {
      "id": "planet-of-lana",
      "title": "Planet of Lana"
    },
    {
      "id": "unravel-two",
      "title": "Unravel Two"
    },
    {
      "id": "cuphead",
      "title": "Cuphead"
    },
    {
      "id": "yooka-laylee-impossible-lair",
      "title": "Yooka-Laylee and the Impossible Lair"
    },
    {
      "id": "new-supers-luckys-tale",
      "title": "New Super Lucky's Tale"
    },
    {
      "id": "pumpkin-jack",
      "title": "Pumpkin Jack"
    },
    {
      "id": "kaze-and-the-wild-masks",
      "title": "Kaze and the Wild Masks"
    },
    {
      "id": "rayman-legends",
      "title": "Rayman Legends"
    },
    {
      "id": "crash-bandicoot-4",
      "title": "Crash Bandicoot 4: It's About Time"
    },
    {
      "id": "neon-white",
      "title": "Neon White"
    },
    {
      "id": "the-artful-escape",
      "title": "The Artful Escape"
    },
    {
      "id": "what-remains-of-edith-finch",
      "title": "What Remains of Edith Finch"
    },
    {
      "id": "life-is-strange-remastered",
      "title": "Life is Strange Remastered Collection"
    },
    {
      "id": "life-is-strange-2",
      "title": "Life is Strange 2"
    },
    {
      "id": "the-quarry",
      "title": "The Quarry"
    },
    {
      "id": "until-dawn",
      "title": "Until Dawn"
    },
    {
      "id": "detroit-become-human",
      "title": "Detroit: Become Human"
    },
    {
      "id": "road-96",
      "title": "Road 96"
    },
    {
      "id": "open-roads",
      "title": "Open Roads"
    },
    {
      "id": "lost-words",
      "title": "Lost Words: Beyond the Page"
    },
    {
      "id": "behind-the-frame",
      "title": "Behind the Frame: The Finest Scenery"
    },
    {
      "id": "old-mans-journey",
      "title": "Old Man's Journey"
    },
    {
      "id": "a-memoir-blue",
      "title": "A Memoir Blue"
    },
    {
      "id": "dordogne",
      "title": "Dordogne"
    },
    {
      "id": "mutazione",
      "title": "Mutazione"
    },
    {
      "id": "norco",
      "title": "Norco"
    },
    {
      "id": "unpacking",
      "title": "Unpacking"
    },
    {
      "id": "coffee-talk",
      "title": "Coffee Talk"
    },
    {
      "id": "coffee-talk-2",
      "title": "Coffee Talk Episode 2: Hibiscus & Butterfly"
    },
    {
      "id": "va-11-hall-a",
      "title": "VA-11 HALL-A: Cyberpunk Bartender Action"
    },
    {
      "id": "goodbye-volcano-high",
      "title": "Goodbye Volcano High"
    },
    {
      "id": "beacon-pines",
      "title": "Beacon Pines"
    },
    {
      "id": "a-space-for-the-unbound",
      "title": "A Space for the Unbound"
    },
    {
      "id": "thirsty-suitors",
      "title": "Thirsty Suitors"
    },
    {
      "id": "wytchwood",
      "title": "Wytchwood"
    },
    {
      "id": "gone-home",
      "title": "Gone Home"
    },
    {
      "id": "twelve-minutes",
      "title": "Twelve Minutes"
    },
    {
      "id": "sea-of-solitude",
      "title": "Sea of Solitude"
    },
    {
      "id": "concrete-genie",
      "title": "Concrete Genie"
    },
    {
      "id": "the-last-campfire",
      "title": "The Last Campfire"
    },
    {
      "id": "omno",
      "title": "Omno"
    },
    {
      "id": "abzu",
      "title": "ABZU"
    },
    {
      "id": "cyberpunk-2077",
      "title": "Cyberpunk 2077"
    },
    {
      "id": "the-witcher-3",
      "title": "The Witcher 3: Wild Hunt"
    },
    {
      "id": "final-fantasy-vii-remake",
      "title": "Final Fantasy VII Remake"
    },
    {
      "id": "nier-automata",
      "title": "NieR: Automata"
    },
    {
      "id": "ghost-of-tsushima",
      "title": "Ghost of Tsushima Director's Cut"
    },
    {
      "id": "spider-man-miles-morales",
      "title": "Marvel's Spider-Man: Miles Morales"
    },
    {
      "id": "death-stranding",
      "title": "Death Stranding Director's Cut"
    },
    {
      "id": "the-last-of-us-part-ii",
      "title": "The Last of Us Part II Remastered"
    },
    {
      "id": "assassins-creed-valhalla",
      "title": "Assassin's Creed Valhalla"
    },
    {
      "id": "immortals-fenyx-rising",
      "title": "Immortals Fenyx Rising"
    },
    {
      "id": "hogwarts-legacy",
      "title": "Hogwarts Legacy"
    },
    {
      "id": "tales-of-arise",
      "title": "Tales of Arise"
    },
    {
      "id": "sifu",
      "title": "Sifu"
    },
    {
      "id": "it-takes-two",
      "title": "It Takes Two"
    },
    {
      "id": "hades",
      "title": "Hades"
    },
    {
      "id": "endling",
      "title": "Endling: Extinction is Forever"
    },
    {
      "id": "astro-bot",
      "title": "Astro Bot"
    },
    {
      "id": "astros-playroom",
      "title": "Astro's Playroom"
    },
    {
      "id": "returnal",
      "title": "Returnal"
    },
    {
      "id": "demons-souls",
      "title": "Demon's Souls"
    },
    {
      "id": "ratchet-rift-apart",
      "title": "Ratchet & Clank: Rift Apart"
    },
    {
      "id": "spider-man-2",
      "title": "Marvel's Spider-Man 2"
    },
    {
      "id": "final-fantasy-xvi",
      "title": "Final Fantasy XVI"
    },
    {
      "id": "stellar-blade",
      "title": "Stellar Blade"
    },
    {
      "id": "rise-of-the-ronin",
      "title": "Rise of the Ronin"
    },
    {
      "id": "baldurs-gate-3",
      "title": "Baldur's Gate 3"
    },
    {
      "id": "helldivers-2",
      "title": "Helldivers 2"
    },
    {
      "id": "gran-turismo-7",
      "title": "Gran Turismo 7"
    },
    {
      "id": "alan-wake-2",
      "title": "Alan Wake 2"
    },
    {
      "id": "black-myth-wukong",
      "title": "Black Myth: Wukong"
    },
    {
      "id": "silent-hill-2",
      "title": "Silent Hill 2"
    },
    {
      "id": "dead-space-remake",
      "title": "Dead Space"
    },
    {
      "id": "the-last-of-us-part-i",
      "title": "The Last of Us Part I"
    },
    {
      "id": "a-plague-tale-requiem",
      "title": "A Plague Tale: Requiem"
    },
    {
      "id": "star-wars-outlaws",
      "title": "Star Wars Outlaws"
    },
    {
      "id": "avatar-frontiers-of-pandora",
      "title": "Avatar: Frontiers of Pandora"
    },
    {
      "id": "ghost-of-yotei",
      "title": "Ghost of Yotei"
    },
    {
      "id": "death-stranding-2",
      "title": "Death Stranding 2: On the Beach"
    },
    {
      "id": "sable",
      "title": "Sable"
    },
    {
      "id": "venba",
      "title": "Venba"
    },
    {
      "id": "little-kitty-big-city",
      "title": "Little Kitty, Big City"
    },
    {
      "id": "jusant",
      "title": "Jusant"
    },
    {
      "id": "the-plucky-squire",
      "title": "The Plucky Squire"
    },
    {
      "id": "neva",
      "title": "Neva"
    },
    {
      "id": "animal-well",
      "title": "Animal Well"
    },
    {
      "id": "lorelei-and-the-laser-eyes",
      "title": "Lorelei and the Laser Eyes"
    },
    {
      "id": "temtem",
      "title": "Temtem"
    },
    {
      "id": "palworld",
      "title": "Palworld"
    },
    {
      "id": "coral-island",
      "title": "Coral Island"
    },
    {
      "id": "fae-farm",
      "title": "Fae Farm"
    },
    {
      "id": "moonstone-island",
      "title": "Moonstone Island"
    },
    {
      "id": "party-animals",
      "title": "Party Animals"
    },
    {
      "id": "sea-of-thieves",
      "title": "Sea of Thieves"
    },
    {
      "id": "phasmophobia",
      "title": "Phasmophobia"
    },
    {
      "id": "the-medium",
      "title": "The Medium"
    },
    {
      "id": "overcooked-all-you-can-eat",
      "title": "Overcooked! All You Can Eat"
    },
    {
      "id": "fall-guys",
      "title": "Fall Guys"
    },
    {
      "id": "rocket-league",
      "title": "Rocket League"
    },
    {
      "id": "minecraft",
      "title": "Minecraft"
    },
    {
      "id": "terraria",
      "title": "Terraria"
    },
    {
      "id": "deep-rock-galactic",
      "title": "Deep Rock Galactic"
    },
    {
      "id": "monster-hunter-world",
      "title": "Monster Hunter: World"
    },
    {
      "id": "monster-hunter-rise",
      "title": "Monster Hunter Rise"
    },
    {
      "id": "human-fall-flat",
      "title": "Human: Fall Flat"
    },
    {
      "id": "gang-beasts",
      "title": "Gang Beasts"
    },
    {
      "id": "moving-out",
      "title": "Moving Out"
    },
    {
      "id": "among-us",
      "title": "Among Us"
    },
    {
      "id": "grounded",
      "title": "Grounded"
    },
    {
      "id": "diablo-iv",
      "title": "Diablo IV"
    },
    {
      "id": "genshin-impact",
      "title": "Genshin Impact"
    },
    {
      "id": "warframe",
      "title": "Warframe"
    },
    {
      "id": "destiny-2",
      "title": "Destiny 2"
    },
    {
      "id": "borderlands-3",
      "title": "Borderlands 3"
    },
    {
      "id": "risk-of-rain-2",
      "title": "Risk of Rain 2"
    },
    {
      "id": "dont-starve-together",
      "title": "Don't Starve Together"
    },
    {
      "id": "ultimate-chicken-horse",
      "title": "Ultimate Chicken Horse"
    },
    {
      "id": "escape-academy",
      "title": "Escape Academy"
    },
    {
      "id": "golf-with-your-friends",
      "title": "Golf With Your Friends"
    },
    {
      "id": "control-ultimate",
      "title": "Control Ultimate Edition"
    },
    {
      "id": "resident-evil-village",
      "title": "Resident Evil Village"
    },
    {
      "id": "resident-evil-4-remake",
      "title": "Resident Evil 4"
    },
    {
      "id": "metro-exodus",
      "title": "Metro Exodus"
    },
    {
      "id": "star-wars-jedi-fallen-order",
      "title": "Star Wars Jedi: Fallen Order"
    },
    {
      "id": "god-of-war",
      "title": "God of War"
    },
    {
      "id": "red-dead-redemption-2",
      "title": "Red Dead Redemption 2"
    },
    {
      "id": "days-gone",
      "title": "Days Gone"
    },
    {
      "id": "a-plague-tale-innocence",
      "title": "A Plague Tale: Innocence"
    },
    {
      "id": "carto",
      "title": "Carto"
    },
    {
      "id": "strange-horticulture",
      "title": "Strange Horticulture"
    },
    {
      "id": "the-gardens-between",
      "title": "The Gardens Between"
    },
    {
      "id": "summer-in-mara",
      "title": "Summer in Mara"
    },
    {
      "id": "the-first-tree",
      "title": "The First Tree"
    },
    {
      "id": "arise-a-simple-story",
      "title": "Arise: A Simple Story"
    },
    {
      "id": "haven",
      "title": "Haven"
    },
    {
      "id": "the-jackbox-party-pack-8",
      "title": "The Jackbox Party Pack 8"
    },
    {
      "id": "nine-sols",
      "title": "Nine Sols"
    },
    {
      "id": "hollow-knight-silksong",
      "title": "Hollow Knight: Silksong"
    },
    {
      "id": "metaphor-refantazio",
      "title": "Metaphor: ReFantazio"
    },
    {
      "id": "persona-5-royal",
      "title": "Persona 5 Royal"
    },
    {
      "id": "core-keeper",
      "title": "Core Keeper"
    },
    {
      "id": "spirittea",
      "title": "Spirittea"
    },
    {
      "id": "bear-and-breakfast",
      "title": "Bear and Breakfast"
    },
    {
      "id": "spirit-of-the-north",
      "title": "Spirit of the North"
    },
    {
      "id": "dragon-quest-builders-2",
      "title": "Dragon Quest Builders 2"
    },
    {
      "id": "clair-obscur-expedition-33",
      "title": "Clair Obscur: Expedition 33"
    },
    {
      "id": "blue-prince",
      "title": "Blue Prince"
    },
    {
      "id": "split-fiction",
      "title": "Split Fiction"
    },
    {
      "id": "wanderstop",
      "title": "Wanderstop"
    },
    {
      "id": "bo-path-of-the-teal-lotus",
      "title": "Bo: Path of the Teal Lotus"
    },
    {
      "id": "monster-hunter-wilds",
      "title": "Monster Hunter Wilds"
    },
    {
      "id": "wylde-flowers",
      "title": "Wylde Flowers"
    },
    {
      "id": "little-nightmares-3",
      "title": "Little Nightmares III"
    },
    {
      "id": "fantasy-life-i",
      "title": "Fantasy Life i: The Girl Who Steals Time"
    },
    {
      "id": "hades-2",
      "title": "Hades II"
    },
    {
      "id": "two-point-museum",
      "title": "Two Point Museum"
    },
    {
      "id": "tales-of-the-shire",
      "title": "Tales of the Shire"
    },
    {
      "id": "tiny-bookshop",
      "title": "Tiny Bookshop"
    },
    {
      "id": "herdling",
      "title": "Herdling"
    },
    {
      "id": "story-of-seasons-grand-bazaar",
      "title": "Story of Seasons: Grand Bazaar"
    },
    {
      "id": "rune-factory-guardians-of-azuma",
      "title": "Rune Factory: Guardians of Azuma"
    }
  ];

  const LOCALE = 'en-us';        // change if you buy from another region
  const PER_GAME_TIMEOUT = 15000;
  const results = {};
  let resolved = 0;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1200px;height:900px;opacity:0';
  document.body.appendChild(frame);

  const findInDocument = (doc) => {
    const anchors = [...doc.querySelectorAll('a[href*="/concept/"], a[href*="/product/"]')];
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href') || '';
      const match = href.match(/\/(concept|product)\/([^/?#]+)/);
      if (!match) continue;
      const name = (anchor.innerText || anchor.textContent || '').trim().split('\n')[0];
      return { kind: match[1], storeId: match[2], storeName: name };
    }
    // Fall back to the raw markup in case the result markup changes.
    const raw = doc.documentElement ? doc.documentElement.innerHTML : '';
    const loose = raw.match(/\/(concept|product)\/([A-Za-z0-9_-]{4,})/);
    return loose ? { kind: loose[1], storeId: loose[2], storeName: '' } : null;
  };

  const search = (title) =>
    new Promise((resolve) => {
      const finish = (value) => {
        clearInterval(poll);
        clearTimeout(cap);
        resolve(value);
      };
      const poll = setInterval(() => {
        try {
          const doc = frame.contentDocument;
          if (!doc || doc.readyState !== 'complete') return;
          const hit = findInDocument(doc);
          if (hit) finish(hit);
        } catch {
          // Cross-origin during a redirect; keep waiting.
        }
      }, 400);
      const cap = setTimeout(() => finish(null), PER_GAME_TIMEOUT);
      frame.src = '/' + LOCALE + '/search/' + encodeURIComponent(title);
    });

  const download = () => {
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'psn-ids.json';
    link.click();
  };
  window.addEventListener('beforeunload', download);

  console.log('Resolving ' + GAMES.length + ' titles. This takes about 10 minutes.');
  for (let index = 0; index < GAMES.length; index += 1) {
    const game = GAMES[index];
    const hit = await search(game.title);
    if (hit) {
      results[game.id] = { title: game.title, ...hit };
      resolved += 1;
    }
    if (index % 10 === 0 || !hit) {
      console.log(
        (index + 1) + '/' + GAMES.length + '  ' + game.title + '  ->  ' +
          (hit ? hit.kind + ' ' + hit.storeId + '  ' + hit.storeName : 'NOT FOUND'),
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  frame.remove();
  window.removeEventListener('beforeunload', download);
  console.log('Done. Resolved ' + resolved + ' of ' + GAMES.length + '. Downloading psn-ids.json');
  download();
})();
