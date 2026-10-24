import type { ConsentCategory } from "./types.js";

export interface ConsentTexts {
  title: string;
  description: string;
  acceptAll: string;
  rejectAll: string;
  customize: string;
  save: string;
  preferencesTitle: string;
  preferencesDescription: string;
  alwaysOn: string;
  privacyPolicy: string;
  close: string;
  poweredBy: string;
  categories: Record<ConsentCategory, { title: string; description: string }>;
}

export type ConsentLocale = "en" | "ru";

export const DEFAULT_TEXTS: Record<ConsentLocale, ConsentTexts> = {
  en: {
    title: "We use cookies",
    description:
      "We use cookies to make the site work, remember your preferences, measure traffic and personalise ads. You choose which categories to allow.",
    acceptAll: "Accept all",
    rejectAll: "Reject all",
    customize: "Customize",
    save: "Save selection",
    preferencesTitle: "Cookie preferences",
    preferencesDescription:
      "Pick the cookie categories you're comfortable with. You can change this at any time.",
    alwaysOn: "Always on",
    privacyPolicy: "Privacy policy",
    close: "Close",
    poweredBy: "Powered by",
    categories: {
      necessary: {
        title: "Necessary",
        description:
          "Required for the site to work — sign-in, security, load balancing. These can't be turned off.",
      },
      preferences: {
        title: "Preferences",
        description: "Remember your choices, such as language or region.",
      },
      statistics: {
        title: "Statistics",
        description: "Help us understand how the site is used through anonymous analytics.",
      },
      marketing: {
        title: "Marketing",
        description: "Used to show relevant ads and measure ad campaigns across sites.",
      },
    },
  },
  ru: {
    title: "Мы используем cookie",
    description:
      "Мы используем cookie, чтобы сайт работал, запоминал ваши настройки, считал посещаемость и показывал релевантную рекламу. Вы сами выбираете, что разрешить.",
    acceptAll: "Принять все",
    rejectAll: "Отклонить все",
    customize: "Настроить",
    save: "Сохранить выбор",
    preferencesTitle: "Настройки cookie",
    preferencesDescription:
      "Выберите категории cookie, которые готовы разрешить. Изменить выбор можно в любой момент.",
    alwaysOn: "Всегда включены",
    privacyPolicy: "Политика конфиденциальности",
    close: "Закрыть",
    poweredBy: "Работает на",
    categories: {
      necessary: {
        title: "Необходимые",
        description:
          "Нужны для работы сайта — вход, безопасность, балансировка нагрузки. Отключить нельзя.",
      },
      preferences: {
        title: "Предпочтения",
        description: "Запоминают ваш выбор, например язык или регион.",
      },
      statistics: {
        title: "Статистика",
        description: "Помогают понять, как используется сайт, с помощью анонимной аналитики.",
      },
      marketing: {
        title: "Маркетинг",
        description: "Используются для показа релевантной рекламы и оценки рекламных кампаний.",
      },
    },
  },
};

export type ConsentTextsOverride = Partial<Omit<ConsentTexts, "categories">> & {
  categories?: Partial<Record<ConsentCategory, Partial<ConsentTexts["categories"][ConsentCategory]>>>;
};

/** Picks a built-in locale from the browser's language list; falls back to English. */
export function detectLocale(): ConsentLocale {
  if (typeof navigator === "undefined") return "en";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const language of languages) {
    const base = language?.toLowerCase().split("-")[0];
    if (base && base in DEFAULT_TEXTS) return base as ConsentLocale;
  }
  return "en";
}

export function resolveTexts(
  locale: ConsentLocale | "auto",
  override?: ConsentTextsOverride,
): ConsentTexts {
  const base = DEFAULT_TEXTS[locale === "auto" ? detectLocale() : locale] ?? DEFAULT_TEXTS.en;
  if (!override) return base;

  const categories = { ...base.categories };
  for (const key of Object.keys(override.categories ?? {}) as ConsentCategory[]) {
    categories[key] = { ...categories[key], ...override.categories?.[key] };
  }
  return { ...base, ...override, categories };
}
