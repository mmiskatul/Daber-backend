export type ScenarioVariation = {
  id: string;
  label: string;
  situation: string;
};

export type ScenarioConversationType = {
  id: string;
  title: string;
  turns: number;
  variations: ScenarioVariation[];
};

export type ScenarioTheme = {
  id: string;
  title: string;
  he: string;
  heChar: string;
  band: string;
  blurb: string;
  palette: {
    warm: string;
    deep: string;
    tint: string;
  };
  locked?: boolean;
  cts: ScenarioConversationType[];
};

export type TutorVoiceId = "dana" | "noam" | "shira";

export const TUTOR_VOICES: Record<
  TutorVoiceId,
  {
    id: TutorVoiceId;
    name: string;
    subtitle: string;
  }
> = {
  dana: {
    id: "dana",
    name: "Dana",
    subtitle: "Warm, patient, direct."
  },
  noam: {
    id: "noam",
    name: "Noam",
    subtitle: "Light, steady, encouraging."
  },
  shira: {
    id: "shira",
    name: "Shira",
    subtitle: "Sharper pace, expressive tone."
  }
};

export const SCENARIO_THEMES: ScenarioTheme[] = [
  {
    id: "supermarket",
    title: "Supermarket",
    he: "בַּסּוּפֶּר",
    heChar: "ס",
    band: "A2–B1",
    blurb: "Bright lights, plastic bags, and the strange social music of buying tomatoes.",
    palette: { warm: "#E8B4A0", deep: "#B8462C", tint: "rgba(184,70,44,0.10)" },
    cts: [
      {
        id: "big-salad",
        title: "Big salad for dinner",
        turns: 8,
        variations: [
          { id: "calm-tuesday", label: "Calm Tuesday", situation: "A quiet Tuesday evening. The produce section is well-stocked and the staff have time to chat." },
          { id: "friday-rush", label: "Friday rush", situation: "Friday afternoon before Shabbat. The produce section is picked-over and busy; some common items are sold out." },
          { id: "chatty-elder", label: "Chatty shopper", situation: "Mid-morning. An elderly woman ahead of the learner is chatting at length with the produce worker about today's tomatoes. The learner is patient — no rush." },
          { id: "rainy-sunday", label: "Rainy Sunday", situation: "A rainy Sunday. The store is unusually quiet and the produce worker is restocking, happy to chat about what looks good today." }
        ]
      }
    ]
  },
  {
    id: "cafe",
    title: "Café",
    he: "בֵּית קָפֶה",
    heChar: "ק",
    band: "A1–A2",
    blurb: "Slow mornings, oat milk, and the espresso machine doing its theatrical hiss.",
    palette: { warm: "#D9A35E", deep: "#8E5C28", tint: "rgba(217,163,94,0.14)" },
    cts: [
      {
        id: "order",
        title: "Ordering a drink + pastry",
        turns: 5,
        variations: [
          { id: "menu-overhead", label: "Menu only overhead", situation: "The menu is overhead on a chalkboard. The learner has to read fast or ask." },
          { id: "sold-out", label: "The croissants are out", situation: "The croissants are gone. Yossi suggests alternatives." },
          { id: "free-pour", label: "Barista's choice", situation: "Yossi suggests today's special — a single-origin pour-over." }
        ]
      }
    ]
  },
  {
    id: "shuk",
    title: "Friday market",
    he: "הַשּׁוּק",
    heChar: "ש",
    band: "B1",
    blurb: "Voices yelling, oranges piled high, three kinds of olives, and a man selling halva on a wager.",
    palette: { warm: "#C9B68A", deep: "#6B7A45", tint: "rgba(107,122,69,0.12)" },
    cts: [
      {
        id: "haggle",
        title: "Haggling at the spice stall",
        turns: 8,
        variations: [
          { id: "classic-game", label: "Classic dance", situation: "Friendly back-and-forth. The vendor enjoys the negotiation." },
          { id: "firm", label: "Firm vendor", situation: "Today's prices are tight. Small movement possible only." },
          { id: "fish-out-water", label: "Tourist tax", situation: "The vendor assumes tourist and prices accordingly. The learner has to push back." }
        ]
      }
    ]
  },
  {
    id: "ministry",
    title: "Interior Ministry",
    he: "מִשְׂרַד הַפְּנִים",
    heChar: "מ",
    band: "B1–B2",
    blurb: "Numbered tickets, sticky chairs, and a clerk behind glass with a stamp older than you.",
    palette: { warm: "#A8B5C5", deep: "#3F4A78", tint: "rgba(63,74,120,0.10)" },
    locked: true,
    cts: [
      {
        id: "renew-id",
        title: "Renewing an ID",
        turns: 9,
        variations: [
          { id: "smooth", label: "Smooth", situation: "Quick day." },
          { id: "missing-doc", label: "Missing doc", situation: "You forgot a document." },
          { id: "wrong-window", label: "Wrong window", situation: "Sent to a different counter." }
        ]
      }
    ]
  }
];

export function getTodayThemeId(date = new Date()): string {
  const day = Math.floor(date.getTime() / 86400000);
  const ids = SCENARIO_THEMES.filter((theme) => !theme.locked).map((theme) => theme.id);
  return ids[day % ids.length] || "supermarket";
}

export function findTheme(themeId: string): ScenarioTheme | undefined {
  return SCENARIO_THEMES.find((theme) => theme.id === themeId);
}
