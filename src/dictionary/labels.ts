// Presentation-only translations of labels retained in the source database.
const LABEL_WORDS: ReadonlyArray<readonly [string, string]> = [
  ["베스트세이브가 항상 가능하진 않은 조합들", "Conditional Bestsave"],
  ["TS가 우측에 위치해도 무방함", "TS may be on the right"],
  ["우측에 위치해도 무방함", "Either side"],
  ["로 시작할 경우", " prefix ·"], ["먼저 3p", "3P first"],
  ["하프 그레이스", "Half Grace"], ["안티죠스", "Anti-Jaws"], ["안티도트", "Antidote"],
  ["죠스", "Jaws"], ["신발", "Shoes"], ["언덕", "Hills"], ["절벽", "Cliff"],
  ["코끼리", "Elephant"], ["다리", "Legs"], ["드래곤", "Dragon"], ["박스", "Box"],
  ["변형", "Alt"], ["펠리시아", "Felicia"], ["탑-헤비", "Top-heavy"], ["하트", "Heart"],
  ["우측", "Right"], ["좌측", "Left"], ["홀드", " hold"], ["셋업", "setup"],
];

export function dictionaryLabel(value: string): string {
  let label = value.replace(/([TILJOSZ])가 ([TILJOSZ])보다 빠를 경우/g, "$1 before $2")
    .replace(/([TILJOSZ])(?:가|이) 나올 경우/g, "$1 next");
  for (const [source, english] of LABEL_WORDS) label = label.split(source).join(english);
  return label;
}
