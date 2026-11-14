import type { CastRunId } from './cast-runs';

export type SpriteCharacterProfile = {
  characterName: string;
  asl: string;
  favoriteDay: string;
  archetype: string;
  description: string;
  nicknames: string;
  crush: string;
  problem: string;
  themeSong: string;
  starterKit: readonly string[];
  stats: readonly { name: string; bonus: string }[];
  hp: number;
  xp: number;
  conditions: readonly string[];
};

// Production character sheets supplied as Desktop screenshots, November 13, 2026.
// The matching Google Sheet supplied text clipped by the screenshot columns.
// These are the characters in 2006, not present-day cast biographies.
// Alec intentionally uses only his existing site details until a sheet is supplied.
export const SPRITE_PROFILES: Partial<Record<CastRunId, SpriteCharacterProfile>> = {
  "mk": {
    "characterName": "Mary-Kate",
    "asl": "13/F/NY",
    "favoriteDay": "",
    "archetype": "\"over it\"",
    "description": "A middle school student who is way too smart and socially savvy to be a middle school student (they're always telling me that). I like way cooler music than all of my friends due to my older brother's incluence and most of my teachers like me a lot. I swim and take pictures.",
    "nicknames": "MK",
    "crush": "Like I'd Tell You LOL",
    "problem": "I have no clue how I am precieved and don't care about it enough to learn right at this moment.",
    "themeSong": "Some Damien Rice sad stuff",
    "starterKit": [
      "Digital Camera",
      "AIM Log-In",
      "Sweatpants",
      "Acting like nothing is a big deal"
    ],
    "stats": [
      {
        "name": "TRL Requesting ability",
        "bonus": "+1"
      },
      {
        "name": "MySpace Coding",
        "bonus": "+90"
      },
      {
        "name": "Limewire Skills",
        "bonus": "+1"
      }
    ],
    "hp": 0,
    "xp": 0,
    "conditions": [
      "FRIED",
      "MELTDOWN"
    ]
  },
  "jen": {
    "characterName": "Jennifer",
    "asl": "15 / F / ATL",
    "favoriteDay": "",
    "archetype": "Homestarrunner.net it's dot com",
    "description": "HS Sohmore. 15. \npart tomboy part theatre nerd\n100% boy crazy but will be gay \nin like 15 years",
    "nicknames": "Blender",
    "crush": "the less-cute guy of the 2 guys me\nand my bestie are talking to.",
    "problem": "truly a little freak and wildly\nunawares.",
    "themeSong": "She's Got a Problem\nFountains of Wayne",
    "starterKit": [
      "Backwards baseball hat",
      "iPod Video"
    ],
    "stats": [
      {
        "name": "TRL Requesting ability",
        "bonus": "+1"
      },
      {
        "name": "Can skateboard fast",
        "bonus": "+3"
      },
      {
        "name": "Broke arm and lied \nabout getting bit by a shark",
        "bonus": "-5"
      }
    ],
    "hp": 3,
    "xp": 2,
    "conditions": [
      "MELTDOWN"
    ]
  },
  "lip": {
    "characterName": "Mavrik Max",
    "asl": "16/ No Thanks/ Chicago",
    "favoriteDay": "21st night of September",
    "archetype": "Inside Joke nerd.",
    "description": "Sophomore art school kid who thinks he's cool because he gets to ride the CTA everywhere unattended. I have Daria black framed plastic square glasses, a series of sarcastic graphic tees, and jeans that can fit a family of 12. I also don't know I'm gay yet but everyone else does.",
    "nicknames": "Phil of the Future, Philadelphia Cheesesteak, Mavvie, Maximiliano, Phlewis, Cookie",
    "crush": "Seth Green",
    "problem": "I'm a token in every room.",
    "themeSong": "Sugar, We're Going Down Swinging",
    "starterKit": [
      "1 engraved iPod with an \"eclectic\" playlist",
      "A random oatmeal pie that's been there for ages",
      "A signed playbill of a school play no one has heard of.",
      "40 sewn-on patches on massively baggy jeans. Comes with chained wallet."
    ],
    "stats": [
      {
        "name": "TRL Requesting ability",
        "bonus": "+1"
      },
      {
        "name": "Social awkwardness",
        "bonus": "-6"
      },
      {
        "name": "Musical knowledge",
        "bonus": "+525600"
      }
    ],
    "hp": 1,
    "xp": 2,
    "conditions": [
      "LEFT ON READ",
      "EXPOSED"
    ]
  },
  "yongwoo": {
    "characterName": "Nic Park",
    "asl": "16/M/Pittsburgh",
    "favoriteDay": "Sadie Hawkins",
    "archetype": "Rudeboy",
    "description": "Very proud Korean American patriot (I love Korea and I love America), taekwondo black belt, bass player, rudeboy, bboy, emo  hater,  uncomfirmed but devoted Catholic ✟",
    "nicknames": "bboy flicker",
    "crush": "Sam Bergman",
    "problem": "fuck emo",
    "themeSong": "Running From The Thought - Dub Pistols",
    "starterKit": [
      "Cargo Pants",
      "Nintendo DS",
      "Orange Slices (x6)",
      "Streetlight Manifesto hoodie"
    ],
    "stats": [
      {
        "name": "TRL Requesting ability",
        "bonus": "+1"
      },
      {
        "name": "Breakdancing",
        "bonus": "+1"
      },
      {
        "name": "Water mobility",
        "bonus": "-3"
      },
      {
        "name": "Punch speed",
        "bonus": "+5"
      },
      {
        "name": "Korean",
        "bonus": "+1945"
      },
      {
        "name": "\"Fuck u dad\"",
        "bonus": "+16"
      }
    ],
    "hp": 0,
    "xp": 0,
    "conditions": []
  },
  "emma": {
    "characterName": "Emma",
    "asl": "9/F/MN",
    "favoriteDay": "3/15/06",
    "archetype": "Paul Frank",
    "description": "I am a tall for my age child with undiagnosed asthma, pixie cut with bangs that I clip to the side with a barrette or slick back with an over sized head band. I wear skorts and an oversized graphic T-shirt",
    "nicknames": "Lulu",
    "crush": "N/A all boys piss me off",
    "problem": "All my friends use me as their therapist",
    "themeSong": "Hamster Dance",
    "starterKit": [],
    "stats": [
      {
        "name": "TRL Requesting ability",
        "bonus": "+1"
      }
    ],
    "hp": 0,
    "xp": 0,
    "conditions": []
  }
};
