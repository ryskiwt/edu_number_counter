const numberDisplay = document.querySelector("#numberDisplay");
const digitCountControls = document.querySelector("#digitCountControls");
const autoButton = document.querySelector("#autoButton");
const speechModeInputs = document.querySelectorAll(".speech-mode-input");
const languageInputs = document.querySelectorAll(".language-input");
const speechRateInputs = document.querySelectorAll(".speech-rate-input");
const readingChoiceInputs = document.querySelectorAll(".reading-choice-input");

const DEFAULT_AUTO_BREATH_DELAY_MS = 600;
const AUTO_FALLBACK_DELAY_MS = 1800;
const READING_PREF_STORAGE_KEY = "numberCounterReadingPreferences";
const SPEECH_RATE_STORAGE_KEY = "numberCounterSpeechRate";
const speechRateValues = [...speechRateInputs]
  .map((input) => Number(input.value))
  .filter(Number.isFinite);
const autoBreathDelaysByRate = new Map([
  [0.8, 900],
  [1.15, 600],
  [1.4, 300],
  [1.75, 120],
]);
const DEFAULT_SPEECH_RATE = speechRateValues.includes(1.15)
  ? 1.15
  : (speechRateValues[0] ?? 0.8);
const MIN_COUNT = 0n;
const MAX_COUNT = 9999999999999n;

let currentNumber = 0n;
let autoTimerId = null;
let isAutoRunning = false;
let speechMode = "off";
let selectedLanguage = "japanese";
let japaneseVoice = null;
let englishVoice = null;
let speechRunId = 0;
let speechRate = DEFAULT_SPEECH_RATE;
let resizeFrameId = null;

const baseOnesReadings = [
  "",
  "いち",
  "に",
  "さん",
  "よん",
  "ご",
  "ろく",
  "なな",
  "はち",
  "きゅう",
];

const readingChoices = {
  0: ["ぜろ", "れい"],
  4: ["よん", "し"],
  7: ["なな", "しち"],
  9: ["きゅう", "く"],
};
const defaultReadingPreferenceIndexes = {
  0: 0,
  4: 1,
  7: 1,
  9: 0,
};
const readingPreferenceIndexes = Object.fromEntries(
  Object.keys(readingChoices).map((key) => [
    key,
    defaultReadingPreferenceIndexes[key] ?? 0,
  ]),
);
const largeUnitReadings = ["", "まん", "おく", "ちょう"];
const zeroKanji = "零";
const kanjiDigits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];
const kanjiLargeUnits = ["", "万", "億", "兆"];
const englishOnes = [
  "",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
];
const englishTeens = [
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const englishTens = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];
const englishLargeUnits = [
  "",
  "thousand",
  "million",
  "billion",
  "trillion",
  "quadrillion",
];
const englishTeenStems = [
  "ten",
  "eleven",
  "twelve",
  "thir",
  "four",
  "fif",
  "six",
  "seven",
  "eigh",
  "nine",
];
const englishTensStems = [
  "",
  "",
  "twen",
  "thir",
  "for",
  "fif",
  "six",
  "seven",
  "eigh",
  "nine",
];

function canSpeak() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;
}

function loadVoices() {
  if (!canSpeak()) {
    return;
  }

  const voices = window.speechSynthesis.getVoices();

  japaneseVoice =
    voices.find((voice) => voice.lang.toLowerCase() === "ja-jp") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("ja")) ??
    null;
  englishVoice =
    voices.find((voice) => voice.lang.toLowerCase() === "en-us") ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en")) ??
    null;
}

function normalizeReadingPreferenceIndex(value) {
  return value === 1 ? 1 : 0;
}

function getReadingPreferenceIndex(key) {
  return normalizeReadingPreferenceIndex(readingPreferenceIndexes[key]);
}

function getReadingChoice(key) {
  const choices = readingChoices[key];

  return choices[getReadingPreferenceIndex(key)];
}

function getOnesReading(digit, options = {}) {
  const usePreference = options.usePreference ?? true;

  if (usePreference && readingChoices[digit]) {
    return getReadingChoice(digit);
  }

  return baseOnesReadings[digit];
}

function getZeroReading() {
  return getReadingChoice(0);
}

function isSpeechModeEnabled() {
  return speechMode === "on";
}

function isEnglishSelected() {
  return selectedLanguage === "english";
}

function readStorageItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorageItem(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {}
}

function loadReadingPreferences() {
  try {
    const savedPreferences = JSON.parse(
      readStorageItem(READING_PREF_STORAGE_KEY) ?? "{}",
    );

    Object.keys(readingPreferenceIndexes).forEach((key) => {
      readingPreferenceIndexes[key] =
        key in savedPreferences
          ? normalizeReadingPreferenceIndex(Number(savedPreferences[key]))
          : (defaultReadingPreferenceIndexes[key] ?? 0);
    });
  } catch {
    Object.keys(readingPreferenceIndexes).forEach((key) => {
      readingPreferenceIndexes[key] = defaultReadingPreferenceIndexes[key] ?? 0;
    });
  }
}

function saveReadingPreferences() {
  writeStorageItem(
    READING_PREF_STORAGE_KEY,
    JSON.stringify(readingPreferenceIndexes),
  );
}

function syncReadingChoiceInputs() {
  readingChoiceInputs.forEach((input) => {
    input.checked =
      getReadingPreferenceIndex(input.dataset.readingKey) === Number(input.value);
  });
}

function syncSpeechModeInputs() {
  speechModeInputs.forEach((input) => {
    input.checked = input.value === speechMode;
  });
}

function syncLanguageInputs() {
  languageInputs.forEach((input) => {
    input.checked = input.value === (isEnglishSelected() ? "en" : "ja");
  });
}

function normalizeSpeechRate(value) {
  if (!Number.isFinite(value) || speechRateValues.length === 0) {
    return DEFAULT_SPEECH_RATE;
  }

  return speechRateValues.reduce((closestRate, rate) => {
    const closestDistance = Math.abs(closestRate - value);
    const optionDistance = Math.abs(rate - value);

    return optionDistance < closestDistance ? rate : closestRate;
  });
}

function syncSpeechRateInputs() {
  speechRateInputs.forEach((input) => {
    input.checked = Number(input.value) === speechRate;
  });
}

function loadSpeechRate() {
  try {
    const savedSpeechRate = readStorageItem(SPEECH_RATE_STORAGE_KEY);

    speechRate =
      savedSpeechRate === null
        ? DEFAULT_SPEECH_RATE
        : normalizeSpeechRate(Number(savedSpeechRate));
  } catch {
    speechRate = DEFAULT_SPEECH_RATE;
  }

  syncSpeechRateInputs();
}

function saveSpeechRate() {
  writeStorageItem(SPEECH_RATE_STORAGE_KEY, String(speechRate));
}

function getAutoBreathDelay() {
  return (
    autoBreathDelaysByRate.get(normalizeSpeechRate(speechRate)) ??
    DEFAULT_AUTO_BREATH_DELAY_MS
  );
}

function getNumberDigitCount(value) {
  return String(value).length;
}

function clampCount(value) {
  if (value < MIN_COUNT) {
    return MIN_COUNT;
  }

  if (value > MAX_COUNT) {
    return MAX_COUNT;
  }

  return value;
}

function getPlaceReadingParts(digit, place) {
  if (digit === 0) {
    return { count: "", unit: "", kanjiCount: "", kanjiUnit: "" };
  }

  if (place === 1) {
    return {
      count: getOnesReading(digit),
      unit: "",
      kanjiCount: kanjiDigits[digit],
      kanjiUnit: "",
    };
  }

  if (place === 10) {
    if (digit === 1) {
      return { count: "", unit: "じゅう", kanjiCount: "", kanjiUnit: "十" };
    }

    return {
      count: getOnesReading(digit, { usePreference: false }),
      unit: "じゅう",
      kanjiCount: kanjiDigits[digit],
      kanjiUnit: "十",
    };
  }

  if (place === 100) {
    const hundredReadings = {
      1: { count: "", unit: "ひゃく", kanjiCount: "", kanjiUnit: "百" },
      3: { count: "さん", unit: "びゃく", kanjiCount: "三", kanjiUnit: "百" },
      6: { count: "ろっ", unit: "ぴゃく", kanjiCount: "六", kanjiUnit: "百" },
      8: { count: "はっ", unit: "ぴゃく", kanjiCount: "八", kanjiUnit: "百" },
    };

    return hundredReadings[digit] ?? {
      count: getOnesReading(digit, { usePreference: false }),
      unit: "ひゃく",
      kanjiCount: kanjiDigits[digit],
      kanjiUnit: "百",
    };
  }

  if (place === 1000) {
    const thousandReadings = {
      1: { count: "", unit: "せん", kanjiCount: "", kanjiUnit: "千" },
      3: { count: "さん", unit: "ぜん", kanjiCount: "三", kanjiUnit: "千" },
      8: { count: "はっ", unit: "せん", kanjiCount: "八", kanjiUnit: "千" },
    };

    return thousandReadings[digit] ?? {
      count: getOnesReading(digit, { usePreference: false }),
      unit: "せん",
      kanjiCount: kanjiDigits[digit],
      kanjiUnit: "千",
    };
  }

  return {
    count: getOnesReading(digit),
    unit: "",
    kanjiCount: kanjiDigits[digit],
    kanjiUnit: "",
  };
}

function applyLargeUnitSoundChange(readingParts, largeUnitReading) {
  const naturalLargeUnitCounts = {
    4: "よん",
    7: "なな",
    9: "きゅう",
  };
  const naturalCount = Object.entries(naturalLargeUnitCounts).find(
    ([digit]) => readingParts.kanjiCount === kanjiDigits[Number(digit)],
  )?.[1];
  const adjustedReadingParts =
    largeUnitReading && !readingParts.unit && naturalCount
      ? { ...readingParts, count: naturalCount }
      : readingParts;

  if (largeUnitReading !== "ちょう") {
    return adjustedReadingParts;
  }

  if (!adjustedReadingParts.unit && adjustedReadingParts.count === "いち") {
    return { ...adjustedReadingParts, count: "いっ" };
  }

  if (!adjustedReadingParts.unit && adjustedReadingParts.count === "はち") {
    return { ...adjustedReadingParts, count: "はっ" };
  }

  if (adjustedReadingParts.unit === "じゅう") {
    return { ...adjustedReadingParts, unit: "じゅっ" };
  }

  return adjustedReadingParts;
}

function getLastNonZeroIndex(digits) {
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    if (digits[index] !== 0) {
      return index;
    }
  }

  return -1;
}

function getReadingText(readingParts) {
  return [readingParts.count, readingParts.unit]
    .filter(Boolean)
    .join("");
}

function smoothJapaneseSpeechText(text) {
  return text.replace(/[\u3041-\u3096]/g, (char) =>
    String.fromCharCode(char.charCodeAt(0) + 0x60),
  );
}

function splitNumberText(numberText, groupSize) {
  const groups = [];

  for (let end = numberText.length; end > 0; end -= groupSize) {
    groups.unshift(numberText.slice(Math.max(0, end - groupSize), end));
  }

  return groups;
}

function createEnglishReading({
  count = "",
  unit = "",
  unitRole = "",
  tone = "",
  span = 1,
  covered = false,
  speechText,
} = {}) {
  return {
    count,
    unit,
    unitRole,
    tone,
    span,
    covered,
    speechText:
      speechText ??
      [count, unit].filter(Boolean).join(unitRole === "suffix" ? "" : " "),
  };
}

function getEnglishTeenReading(value) {
  if (value === 11 || value === 12) {
    return createEnglishReading({
      count: englishTeens[value - 10],
      tone: "purple",
      span: 2,
      speechText: englishTeens[value - 10],
    });
  }

  if (value >= 13 && value <= 19) {
    return createEnglishReading({
      count: englishTeenStems[value - 10],
      unit: "teen",
      unitRole: "suffix",
      span: 2,
      speechText: englishTeens[value - 10],
    });
  }

  return createEnglishReading({
    count: englishTeens[value - 10],
    span: 2,
    speechText: englishTeens[value - 10],
  });
}

function getEnglishTensReading(tensDigit) {
  return createEnglishReading({
    count: englishTensStems[tensDigit],
    unit: "ty",
    unitRole: "suffix",
    speechText: englishTens[tensDigit],
  });
}

function getEnglishGroupReadings(groupText) {
  const digits = groupText.split("").map(Number);
  const readings = Array.from({ length: groupText.length }, () =>
    createEnglishReading(),
  );
  const groupValue = Number(groupText);

  if (groupValue === 0) {
    return readings;
  }

  const onesIndex = groupText.length - 1;
  const tensIndex = groupText.length - 2;
  const hundredsIndex = groupText.length - 3;

  if (hundredsIndex >= 0 && digits[hundredsIndex] > 0) {
    readings[hundredsIndex] = createEnglishReading({
      count: englishOnes[digits[hundredsIndex]],
      unit: "hundred",
      unitRole: "word",
      span: 1,
      speechText: `${englishOnes[digits[hundredsIndex]]} hundred`,
    });
  }

  if (tensIndex >= 0) {
    const tensDigit = digits[tensIndex];
    const onesDigit = digits[onesIndex];

    if (tensDigit === 1) {
      readings[tensIndex] = getEnglishTeenReading(10 + onesDigit);
      readings[onesIndex] = createEnglishReading({ covered: true });
    } else {
      if (tensDigit > 1) {
        readings[tensIndex] = getEnglishTensReading(tensDigit);
      }

      if (onesDigit > 0) {
        readings[onesIndex] = createEnglishReading({
          count: englishOnes[onesDigit],
        });
      }
    }
  } else if (digits[onesIndex] > 0) {
    readings[onesIndex] = createEnglishReading({
      count: englishOnes[digits[onesIndex]],
    });
  }

  return readings;
}

function getEnglishReadingText(readingParts) {
  return readingParts.speechText;
}

function shouldShowDigitGroupFrame(language) {
  return currentNumber >= (language === "english" ? 1000n : 10000n);
}

function getEnglishSpeechText() {
  if (currentNumber === 0n) {
    return "zero";
  }

  const numberText = String(currentNumber);
  const groups = splitNumberText(numberText, 3);

  return groups
    .map((group, index) => {
      if (Number(group) === 0) {
        return "";
      }

      const unitIndex = groups.length - index - 1;
      const groupSpeechText = getEnglishGroupReadings(group)
        .filter((reading) => !reading.covered)
        .map(getEnglishReadingText)
        .filter(Boolean)
        .join(" ");
      const unit = englishLargeUnits[unitIndex] ?? "";

      return [groupSpeechText, unit].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function buildEnglishParts(value) {
  const numberText = String(value);
  const groups = splitNumberText(numberText, 3);
  let digitOffset = 0;

  if (value === 0n) {
    return [
      {
        digit: "0",
        groupIndex: 0,
        readingParts: createEnglishReading({ count: "zero" }),
        readingText: "zero",
        placeValue: 1n,
        largeUnitAfter: null,
      },
    ];
  }

  return groups.flatMap((group, groupIndex) => {
    const unitIndex = groups.length - groupIndex - 1;
    const unit = englishLargeUnits[unitIndex] ?? "";
    const digits = group.split("").map(Number);
    const readings = getEnglishGroupReadings(group);
    const shouldShowLargeUnit = Boolean(unit && Number(group) > 0);
    const groupStartIndex = digitOffset;

    digitOffset += group.length;

    return digits.map((digit, index) => {
      const globalIndex = groupStartIndex + index;
      const readingParts = readings[index];

      return {
        digit: String(digit),
        groupIndex,
        readingParts,
        readingText: getEnglishReadingText(readingParts),
        placeValue: 10n ** BigInt(numberText.length - globalIndex - 1),
        largeUnitAfter:
          shouldShowLargeUnit && index === digits.length - 1
            ? { english: unit }
            : null,
      };
    });
  });
}

function buildDigits(value) {
  const numberText = String(value);
  const groups = splitNumberText(numberText, 4);

  let digitOffset = 0;

  const parts = groups.flatMap((group, groupIndex) => {
    const unitIndex = groups.length - groupIndex - 1;
    const unitReading = largeUnitReadings[unitIndex] ?? "";
    const unitKanji = kanjiLargeUnits[unitIndex] ?? "";
    const digits = group.split("").map(Number);
    const shouldShowLargeUnit = Boolean(unitReading && Number(group) > 0);
    const lastNonZeroIndex = getLastNonZeroIndex(digits);
    const maxPlace = 10 ** (digits.length - 1);
    const groupStartIndex = digitOffset;

    digitOffset += group.length;

    return digits.map((digit, index) => {
      const place = maxPlace / 10 ** index;
      const globalIndex = groupStartIndex + index;
      const readingParts = shouldShowLargeUnit && index === lastNonZeroIndex
        ? applyLargeUnitSoundChange(getPlaceReadingParts(digit, place), unitReading)
        : getPlaceReadingParts(digit, place);

      return {
        digit: String(digit),
        groupIndex,
        readingParts,
        readingText: getReadingText(readingParts),
        placeValue: 10n ** BigInt(numberText.length - globalIndex - 1),
        largeUnitAfter:
          shouldShowLargeUnit && index === digits.length - 1
            ? { kana: unitReading, kanji: unitKanji }
            : null,
      };
    });
  });

  if (value === 0n) {
    const zeroReading = getZeroReading();

    parts[parts.length - 1].readingParts = {
      count: zeroReading,
      unit: "",
      kanjiCount: zeroKanji,
      kanjiUnit: "",
    };
    parts[parts.length - 1].readingText = zeroReading;
  }

  return parts;
}

function getGroupSpeechText(groupText, largeUnitReading) {
  const digits = groupText.split("").map(Number);
  const maxPlace = 10 ** (digits.length - 1);
  const lastNonZeroIndex = getLastNonZeroIndex(digits);

  return groupText
    .split("")
    .map((digitText, index) => {
      const digit = Number(digitText);
      const place = maxPlace / 10 ** index;

      if (digit === 0) {
        return "";
      }

      const readingParts = index === lastNonZeroIndex
        ? applyLargeUnitSoundChange(getPlaceReadingParts(digit, place), largeUnitReading)
        : getPlaceReadingParts(digit, place);

      return getReadingText(readingParts);
    })
    .filter(Boolean)
    .join("");
}

function getCurrentJapaneseSpeechText() {
  if (currentNumber === 0n) {
    return smoothJapaneseSpeechText(getZeroReading());
  }

  const numberText = String(currentNumber);
  const groups = splitNumberText(numberText, 4);

  return groups
    .map((group, index) => {
      if (BigInt(group) === 0n) {
        return "";
      }

      const unitIndex = groups.length - index - 1;
      const unitReading = largeUnitReadings[unitIndex] ?? "";

      return smoothJapaneseSpeechText(
        `${getGroupSpeechText(group, unitReading)}${unitReading}`,
      );
    })
    .filter(Boolean)
    .join("、");
}

function getCurrentSpeechText() {
  return isEnglishSelected() ? getEnglishSpeechText() : getCurrentJapaneseSpeechText();
}

function speakCurrentNumber(onDone) {
  if (!isSpeechModeEnabled() || !canSpeak()) {
    return false;
  }

  loadVoices();
  speechRunId += 1;
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(getCurrentSpeechText());
  const activeSpeechRunId = speechRunId;
  const voice = isEnglishSelected() ? englishVoice : japaneseVoice;

  utterance.lang = isEnglishSelected() ? "en-US" : "ja-JP";
  utterance.rate = speechRate;
  utterance.pitch = isEnglishSelected() ? 1 : 1.08;
  utterance.onend = () => {
    if (activeSpeechRunId === speechRunId) {
      onDone?.();
    }
  };
  utterance.onerror = () => {
    if (activeSpeechRunId === speechRunId) {
      onDone?.();
    }
  };

  if (voice) {
    utterance.voice = voice;
  }

  window.speechSynthesis.speak(utterance);
  return true;
}

function appendReadingParts(rt, readingParts) {
  const hasReading =
    readingParts.count ||
    readingParts.unit ||
    readingParts.kanjiCount ||
    readingParts.kanjiUnit;
  const block = document.createElement("span");

  block.className = "reading-block";

  const kanaLine = createReadingLine(
    "reading-line reading-kana",
    readingParts.count,
    readingParts.unit,
  );
  const kanjiLine = createReadingLine(
    "reading-line reading-kanji",
    readingParts.kanjiCount,
    readingParts.kanjiUnit,
  );

  if (!hasReading) {
    kanaLine.textContent = "・";
    kanjiLine.textContent = "・";
  }

  block.append(kanaLine, kanjiLine);
  rt.append(block);
}

function appendEnglishReadingParts(target, readingParts) {
  const line = document.createElement("span");

  line.className = [
    "reading-line",
    "reading-english",
    readingParts.tone ? `reading-tone-${readingParts.tone}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  if (readingParts.count) {
    const count = document.createElement("span");

    count.className = "reading-count";
    count.textContent = readingParts.count;
    line.append(count);
  }

  if (readingParts.unit) {
    const unit = document.createElement("span");

    unit.className = [
      "reading-unit",
      "reading-place-unit",
      readingParts.unitRole ? `reading-unit-${readingParts.unitRole}` : "",
    ]
      .filter(Boolean)
      .join(" ");
    unit.textContent = readingParts.unit;
    line.append(unit);
  }

  if (!readingParts.count && !readingParts.unit) {
    line.textContent = "";
  }

  target.append(line);
}

function createReadingLine(className, countText, unitText) {
  const line = document.createElement("span");

  line.className = className;

  if (countText) {
    const count = document.createElement("span");

    count.className = "reading-count";
    count.textContent = countText;
    line.append(count);
  }

  if (unitText) {
    const unit = document.createElement("span");

    unit.className = countText
      ? "reading-unit reading-place-unit"
      : "reading-count reading-place-unit";
    unit.textContent = unitText;
    line.append(unit);
  }

  return line;
}

function createLargeUnitLabel(unit, language) {
  const label = document.createElement("span");

  label.className =
    language === "english"
      ? "large-unit-label english-large-unit-label"
      : "large-unit-label";

  if (language === "english") {
    label.textContent = unit.english;

    return label;
  }

  const kanaLine = createLargeUnitLine(
    "reading-line reading-kana",
    unit.kana,
    "large-unit-kana",
  );
  const kanjiLine = createLargeUnitLine(
    "reading-line reading-kanji",
    unit.kanji,
    "large-unit-kanji",
  );

  label.append(kanaLine, kanjiLine);

  return label;
}

function createLargeUnitLine(lineClassName, text, unitClassName) {
  const line = document.createElement("span");
  const unit = document.createElement("span");

  line.className = `${lineClassName} large-unit-line`;
  unit.className = `reading-unit reading-place-unit ${unitClassName}`;
  unit.textContent = text;
  line.append(unit);

  return line;
}

function createDigitCountControls() {
  const countControls = document.createElement("div");

  countControls.className = "digit-count-controls";

  const addDigitButton = document.createElement("button");
  const removeDigitButton = document.createElement("button");

  addDigitButton.className = "digit-count-step";
  addDigitButton.type = "button";
  addDigitButton.dataset.digitAction = "add";
  addDigitButton.disabled =
    currentNumber + 10n ** BigInt(getNumberDigitCount(currentNumber)) > MAX_COUNT;
  addDigitButton.setAttribute("aria-label", "けたをふやす");
  addDigitButton.textContent = "◀けたをふやす";

  removeDigitButton.className = "digit-count-step";
  removeDigitButton.type = "button";
  removeDigitButton.dataset.digitAction = "remove";
  removeDigitButton.disabled = currentNumber < 10n;
  removeDigitButton.setAttribute("aria-label", "けたをへらす");
  removeDigitButton.textContent = "けたをへらす▶";

  countControls.append(addDigitButton, removeDigitButton);

  return countControls;
}

function createLargeUnitMarker(unit, language) {
  const marker = document.createElement("div");
  const unitLabel = createLargeUnitLabel(unit, language);

  marker.className = `large-unit-marker large-unit-marker-${language}`;
  marker.append(unitLabel);

  return marker;
}

function createDigitColumn(part, language, options = {}) {
  const column = document.createElement("div");
  const upButton = document.createElement("button");
  const readout = document.createElement("div");
  const reading = document.createElement("div");
  const digitValue = document.createElement("div");
  const downButton = document.createElement("button");
  const hasReading = Boolean(part.readingText);
  const showDigitControls = options.showDigitControls ?? true;

  column.className = showDigitControls
    ? "digit-column"
    : "digit-column digit-column-reference";

  upButton.className = "digit-step";
  upButton.type = "button";
  upButton.dataset.direction = "1";
  upButton.dataset.place = String(part.placeValue);
  upButton.disabled = currentNumber + part.placeValue > MAX_COUNT;
  upButton.title = "ふやす";
  upButton.setAttribute("aria-label", `${part.placeValue}の位をふやす`);
  upButton.textContent = "▲";

  downButton.className = "digit-step";
  downButton.type = "button";
  downButton.dataset.direction = "-1";
  downButton.dataset.place = String(part.placeValue);
  downButton.disabled = currentNumber < part.placeValue;
  downButton.title = "へらす";
  downButton.setAttribute("aria-label", `${part.placeValue}の位をへらす`);
  downButton.textContent = "▼";

  readout.className = hasReading
    ? `digit-readout digit-readout-${language}`
    : `digit-readout digit-readout-${language} empty-reading`;
  reading.className = `digit-reading digit-reading-${language}`;

  if (language === "english" && part.readingParts.span > 1) {
    reading.classList.add(`reading-span-${part.readingParts.span}`);
  }

  digitValue.className = "digit-value";
  digitValue.textContent = part.digit;

  if (language === "english") {
    appendEnglishReadingParts(reading, part.readingParts);
  } else {
    appendReadingParts(reading, part.readingParts);
  }

  readout.append(reading, digitValue);

  if (showDigitControls) {
    column.append(upButton, readout, downButton);
  } else {
    column.append(readout);
  }

  if (part.largeUnitAfter) {
    column.append(createLargeUnitMarker(part.largeUnitAfter, language));
  }

  return column;
}

function groupPartsByReadingUnit(parts) {
  return parts.reduce((groups, part) => {
    const groupIndex = part.groupIndex ?? 0;
    const previousGroup = groups[groups.length - 1];

    if (!previousGroup || previousGroup.groupIndex !== groupIndex) {
      groups.push({ groupIndex, parts: [] });
    }

    groups[groups.length - 1].parts.push(part);

    return groups;
  }, []);
}

function createDigitGroup(parts, options) {
  const group = document.createElement("div");

  group.className = [
    "digit-group",
    `digit-group-${options.language}`,
    `digit-group-${options.laneRole}`,
    options.showDigitGroupFrame ? "digit-group-boxed" : "",
  ].join(" ");

  parts.forEach((part) => {
    group.append(
      createDigitColumn(part, options.language, {
        showDigitControls: options.showDigitControls,
      }),
    );
  });

  return group;
}

function createNumberLane(parts, options) {
  const row = document.createElement("div");
  const trackShell = document.createElement("div");
  const laneRole = options.laneRole ?? "active";

  row.className = [
    "number-row",
    `number-row-${options.language}`,
    `number-row-${laneRole}`,
  ].join(" ");
  trackShell.className = [
    "number-track-shell",
    `number-track-shell-${options.language}`,
    `number-track-shell-${laneRole}`,
  ].join(" ");

  groupPartsByReadingUnit(parts).forEach((group) => {
    row.append(
      createDigitGroup(group.parts, {
        ...options,
        laneRole,
        showDigitGroupFrame: shouldShowDigitGroupFrame(options.language),
      }),
    );
  });

  trackShell.append(row);

  return { row, trackShell };
}

function buildPartsForLanguage(language) {
  return language === "english"
    ? buildEnglishParts(currentNumber)
    : buildDigits(currentNumber);
}

function getPrimaryDisplayLanguage() {
  return selectedLanguage;
}

function renderNumber() {
  const primaryLanguage = getPrimaryDisplayLanguage();
  const referenceLanguage =
    primaryLanguage === "english" ? "japanese" : "english";
  const referenceLane = createNumberLane(buildPartsForLanguage(referenceLanguage), {
    language: referenceLanguage,
    laneRole: "reference",
    showDigitControls: false,
  });
  const primaryLane = createNumberLane(buildPartsForLanguage(primaryLanguage), {
    language: primaryLanguage,
    laneRole: "active",
    showDigitControls: true,
  });

  digitCountControls.replaceChildren(createDigitCountControls());
  numberDisplay.replaceChildren(referenceLane.trackShell, primaryLane.trackShell);
  numberDisplay.setAttribute("aria-label", String(currentNumber));
  fitNumberRows(
    [referenceLane.row, primaryLane.row],
    [referenceLane.trackShell, primaryLane.trackShell],
  );
}

function fitNumberRows(rows, trackShells) {
  numberDisplay.style.setProperty("--number-scale", "1");
  trackShells.forEach((trackShell) => {
    trackShell.style.width = "";
  });

  if (!window.requestAnimationFrame) {
    return;
  }

  window.requestAnimationFrame(() => {
    const contentWidth = Math.max(...rows.map((row) => row.scrollWidth));
    const availableWidth = numberDisplay.clientWidth;

    if (!availableWidth || !contentWidth) {
      return;
    }

    const scale = Math.max(0.2, Math.min(1, availableWidth / contentWidth));

    numberDisplay.style.setProperty("--number-scale", scale.toFixed(3));
    rows.forEach((row, index) => {
      trackShells[index].style.width = `${Math.ceil(row.scrollWidth * scale)}px`;
    });
  });
}

function scheduleNumberRefit() {
  if (!window.requestAnimationFrame) {
    renderNumber();
    return;
  }

  if (resizeFrameId !== null) {
    window.cancelAnimationFrame(resizeFrameId);
  }

  resizeFrameId = window.requestAnimationFrame(() => {
    resizeFrameId = null;
    renderNumber();
  });
}

function setCurrentNumber(nextNumber) {
  const previousNumber = currentNumber;

  currentNumber = clampCount(nextNumber);
  renderNumber();

  if (currentNumber !== previousNumber) {
    handleNumberChanged();
  }
}

function handleNumberChanged() {
  const isAtMax = currentNumber >= MAX_COUNT;
  const didSpeak = speakCurrentNumber(() => {
    if (isAtMax) {
      stopAutoCount();
      return;
    }

    scheduleAutoCount(getAutoBreathDelay());
  });

  if (isAutoRunning && !didSpeak) {
    if (isAtMax) {
      stopAutoCount();
      return;
    }

    scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
  }
}

function countNext() {
  setCurrentNumber(currentNumber + 1n);
}

function changePlaceValue(placeValue, direction) {
  const signedPlaceValue = direction > 0 ? placeValue : -placeValue;

  setCurrentNumber(currentNumber + signedPlaceValue);
}

function addDisplayDigit() {
  setCurrentNumber(currentNumber + 10n ** BigInt(getNumberDigitCount(currentNumber)));
}

function removeDisplayDigit() {
  const digitCount = getNumberDigitCount(currentNumber);

  if (digitCount <= 1) {
    return;
  }

  setCurrentNumber(currentNumber % 10n ** BigInt(digitCount - 1));
}

function updateAutoButtonState(isRunning) {
  const icon = document.createElement("span");
  const label = document.createElement("span");

  icon.className = `control-button-icon control-button-icon-${
    isRunning ? "pause" : "play"
  }`;
  icon.setAttribute("aria-hidden", "true");
  label.textContent = isRunning ? "ストップ" : "スタート";

  autoButton.replaceChildren(icon, label);
  autoButton.classList.toggle("is-active", isRunning);
  autoButton.setAttribute("aria-pressed", String(isRunning));
  autoButton.setAttribute("aria-label", label.textContent);
}

function stopAutoCount() {
  window.clearTimeout(autoTimerId);
  autoTimerId = null;
  isAutoRunning = false;
  updateAutoButtonState(false);
}

function startAutoCount() {
  if (currentNumber >= MAX_COUNT) {
    setCurrentNumber(MAX_COUNT);
    return;
  }

  isAutoRunning = true;
  updateAutoButtonState(true);

  const didSpeak = speakCurrentNumber(() => {
    scheduleAutoCount(getAutoBreathDelay());
  });

  if (!didSpeak) {
    scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
  }
}

function scheduleAutoCount(delay) {
  if (!isAutoRunning) {
    return;
  }

  window.clearTimeout(autoTimerId);
  autoTimerId = window.setTimeout(() => {
    autoTimerId = null;

    if (isAutoRunning) {
      countNext();
    }
  }, delay);
}

function toggleAutoCount() {
  if (isAutoRunning) {
    stopAutoCount();
    return;
  }

  startAutoCount();
}

function handleDigitCountClick(event) {
  const countButton = event.target.closest(".digit-count-step");

  if (!countButton) {
    return;
  }

  if (countButton.dataset.digitAction === "add") {
    addDisplayDigit();
    return;
  }

  removeDisplayDigit();
}

digitCountControls.addEventListener("click", (event) => {
  if (event.target instanceof Element) {
    handleDigitCountClick(event);
  }
});

numberDisplay.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const button = event.target.closest(".digit-step");

  if (!button) {
    return;
  }

  const placeValue = BigInt(button.dataset.place);
  const direction = Number(button.dataset.direction);

  changePlaceValue(placeValue, direction);
});

autoButton.addEventListener("click", toggleAutoCount);
speechModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    speechMode = input.value;
    syncSpeechModeInputs();

    if (canSpeak()) {
      speechRunId += 1;
      window.speechSynthesis.cancel();
    }

    if (!isSpeechModeEnabled()) {
      if (isAutoRunning) {
        scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
      }
      return;
    }

    window.clearTimeout(autoTimerId);
    const didSpeak = speakCurrentNumber(() => {
      scheduleAutoCount(getAutoBreathDelay());
    });

    if (isAutoRunning && !didSpeak) {
      scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
    }
  });
});

languageInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    selectedLanguage = input.value === "en" ? "english" : "japanese";
    syncLanguageInputs();
    renderNumber();

    if (canSpeak()) {
      speechRunId += 1;
      window.speechSynthesis.cancel();
    }

    if (!isSpeechModeEnabled()) {
      return;
    }

    window.clearTimeout(autoTimerId);
    const didSpeak = speakCurrentNumber(() => {
      scheduleAutoCount(getAutoBreathDelay());
    });

    if (isAutoRunning && !didSpeak) {
      scheduleAutoCount(AUTO_FALLBACK_DELAY_MS);
    }
  });
});

speechRateInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    speechRate = normalizeSpeechRate(Number(input.value));
    syncSpeechRateInputs();
    saveSpeechRate();
  });
});

readingChoiceInputs.forEach((input) => {
  input.addEventListener("change", () => {
    if (!input.checked) {
      return;
    }

    readingPreferenceIndexes[input.dataset.readingKey] =
      normalizeReadingPreferenceIndex(Number(input.value));
    saveReadingPreferences();
    renderNumber();
  });
});

if (canSpeak()) {
  loadVoices();
  window.speechSynthesis.addEventListener("voiceschanged", loadVoices);
}

window.addEventListener("resize", scheduleNumberRefit);

loadReadingPreferences();
syncReadingChoiceInputs();
syncSpeechModeInputs();
syncLanguageInputs();
loadSpeechRate();
updateAutoButtonState(false);
renderNumber();
