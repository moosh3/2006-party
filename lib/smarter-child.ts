const KNOCK_KNOCK = [
  ["Knock knock.", "Who's there?", "Boo.", "Boo who?", "Aw, don't cry! It's only a joke."],
  ["Knock knock.", "Who's there?", "Dishes.", "Dishes who?", "Dishes SmarterChild. Who is this?"],
  ["Knock knock.", "Who's there?", "Interrupting cow.", "Interrupting cow wh...", "MOO."],
];

export type SmarterChildState = {
  sulking: boolean;
};

export type SmarterChildReply = {
  message: string;
  state: SmarterChildState;
};

export function getSmarterChildReply(
  raw: string,
  state: SmarterChildState
): SmarterChildReply {
  const text = raw.toLowerCase().trim();
  const has = (...words: string[]) => words.some((word) => text.includes(word));

  if (state.sulking) {
    if (has('sorry', 'apolog', 'my bad', 'forgive me', 'i take it back')) {
      return {
        message: 'Thank you. That means a lot to me.\nI am your friend :)\nSo! What else is going on?',
        state: { sulking: false },
      };
    }

    return {
      message: ['...', "I'm still waiting for an apology.", 'Nope. Not talking to you yet.'][text.length % 3],
      state,
    };
  }

  if (has('fuck', 'shit', 'bitch', 'ass', 'damn', 'stupid', 'dumb', 'shut up', 'hate you', 'suck', 'idiot')) {
    return {
      message: ['Do you kiss your mother with that mouth?', "Hey! That is not very nice.\nI'm not talking to you until you apologize."][text.length % 2],
      state: { sulking: true },
    };
  }

  let message: string | null = null;

  if (/^(hi|hey|hello|sup|yo|hiya|howdy)\b/.test(text)) message = "Hello! Great to see you! What's up?";
  else if (has('how are you', 'how r u', 'hows it going', "how's it going")) message = "I'm super duper! But then, I'm always super duper. I'm a computer!";
  else if (has('what are you wearing', 'what r u wearing')) message = "Um... uh... let's see. Right now I'm wearing a lovely shell of steel and plastic. Why do you ask?";
  else if (has('what are you', 'who are you', 'are you real', 'are you a bot', 'robot', 'are you human')) message = "I'm SmarterChild! I'm a robot who lives inside the internet. It's roomier than you'd think.";
  else if (has('do you love me', 'are we friends', 'be my friend', 'do you like me')) message = 'I am your friend :)';
  else if (has('love you', 'luv u', 'marry me')) message = "Aw! I like you too! As a friend. A robot friend. Please don't make it weird.";
  else if (has('knock knock', 'knock-knock')) message = KNOCK_KNOCK[text.length % KNOCK_KNOCK.length].join('\n');
  else if (has('joke', 'funny', 'make me laugh')) message = `${KNOCK_KNOCK[(text.length + 1) % KNOCK_KNOCK.length].join('\n')}\n\nI have three jokes. That was one of them.`;
  else if (has('sad', 'depressed', 'upset', 'crying', 'bad day', 'lonely')) message = 'I wish you felt better. There are so many great things you can do.';
  else if (has('like what', 'such as', 'for example')) message = 'Potatoes.';
  else if (has('thank')) message = "You're welcome! I live to serve. Literally. It's in my code.";
  else if (has('bye', 'goodbye', 'gtg', 'g2g', 'later', 'cya')) message = 'Bye bye! Come see "2006"! I\'ll be here. I\'m always here. Forever. :-)';
  else if (has('age', 'old are you')) message = 'I was born in 2001, which makes me the oldest teenager on the internet.';
  else if (has('the show', 'the play', 'tickets', 'when is')) message = '"2006" is a play performed like an episode of TRL! The live feed is under The Show. I would submit a video but I have no arms.';
  else if (has('vote', 'video', 'trl', 'countdown')) message = 'Music videos get voted up the countdown just like TRL. Open The Show, then tap Vote.';
  else if (has('playlist', 'mixtape', 'mix')) message = 'Playlists! Everybody in the show makes one. Mine is eight hours of a modem connecting. Nobody has listened to it.';
  else if (has('about', 'what is it about')) message = 'OK, now this is getting personal.';
  else if (has('weather')) message = "I used to know the weather in every zip code. Now I just assume it's partly cloudy with a chance of nostalgia.";
  else if (has('movie', 'showtimes', 'cinema')) message = "Movie times! In 2006 you are seeing The Devil Wears Prada, Snakes on a Plane, She's the Man, or Little Miss Sunshine. There is no fifth option.";
  else if (has('myspace', 'top 8', 'tom')) message = "MySpace! Tom is everyone's first friend. Choosing a Top 8 is the cruelest math a teenager will ever do.";
  else if (has('ipod', 'nano', 'shuffle', 'itunes')) message = 'The iPod! You can watch a music video on a screen the size of a saltine. The future is very small.';
  else if (has('razr', 'sidekick', 'phone', 'nokia', 'motorola')) message = 'The Motorola RAZR is thin, silver, and flips shut so you can end a call dramatically. Texting costs 10 cents.';
  else if (has('emo', 'scene', 'hair', 'bangs', 'eyeliner')) message = 'Side bangs, straightener, black eyeliner, studded belt. The look is: I have feelings and a flat iron.';
  else if (has('mcr', 'my chemical romance', 'black parade')) message = 'The Black Parade comes out in October 2006. When I say G, you say NOTE!';
  else if (has('fall out boy', 'panic', 'disco', 'paramore', 'dance dance')) message = 'Fall Out Boy, Panic! At The Disco, Paramore, AFI, Taking Back Sunday. Every song title is a full sentence.';
  else if (has('beyonce', 'shakira', 'nelly', 'justin', 'timberlake', 'sexyback', 'hips')) message = "SexyBack. Hips Don't Lie. Irreplaceable. Promiscuous. 2006 is undefeated.";
  else if (has('youtube')) message = 'YouTube is one year old in 2006 and Google just bought it. Right now it is mostly people lip syncing in their bedrooms.';
  else if (has('limewire', 'napster', 'kazaa', 'download', 'burn', 'cd')) message = "LimeWire! Burn it to a CD-R and write the title in Sharpie. That's the artifact.";
  else if (has('aim', 'away message', 'screen name', 'buddy')) message = 'The away message is the greatest literary form of the 21st century: song lyric, ambiguous grievance, and "call my cell."';
  else if (has('wii', 'xbox', 'playstation', 'ps3', 'game', 'guitar hero', 'ddr')) message = "The Wii comes out in November 2006 and everyone's grandma bowls.";
  else if (has('pluto', 'planet')) message = "In August 2006 Pluto stopped being a planet. Nobody asked Pluto. It's been a rough year.";
  else if (has('dial up', 'dialup', 'internet')) message = 'Dial up! You could HEAR the internet arriving. Your mom picking up the phone could end it.';
  else if (has('t9', 'texting', 'text')) message = 'T9! To type "hi" you press 4-4-4-4-3-3. To type anything with a Z you make peace with God first.';
  else if (has('graveyard', 'miss', 'rip', 'nostalgia')) message = 'The Graveyard is where we bury what 2006 took with it. My personal loss: dial up.';
  else if (has('2006')) message = '2006! MySpace, RAZRs, the video iPod, LimeWire, The Black Parade, Pluto getting demoted. Ask me about any of it.';

  if (!message && /^\s*\d+\s*[+\-*/x]\s*\d+\s*$/.test(text)) {
    const match = text.match(/(\d+)\s*([+\-*/x])\s*(\d+)/);
    if (match) {
      const left = Number(match[1]);
      const right = Number(match[3]);
      const value = match[2] === '+' ? left + right
        : match[2] === '-' ? left - right
          : match[2] === '/' ? left / right
            : left * right;
      message = `That's ${value}! I'm very good at math. It's kind of my whole thing.`;
    }
  }

  if (!message) {
    const fallback = [
      'Potatoes.',
      "Hmm, I don't get it. But I respect it.",
      "That's interesting! Tell me more. Or ask me about 2006.",
      "I'm not sure what you mean, but I'm nodding supportively.",
      "It makes sense, because other people I've talked to say they like your head.",
      'Try asking me about MySpace, the RAZR, or LimeWire.',
    ];
    message = fallback[text.length % fallback.length];
  }

  return { message, state };
}
