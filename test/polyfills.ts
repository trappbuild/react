// jsdom lacks AnimationEvent, so React would listen for `webkitAnimationEnd` instead of
// `animationend`. Must load before react-dom.
if (typeof window !== "undefined" && !("AnimationEvent" in window)) {
  class AnimationEvent extends Event {}
  Object.defineProperty(window, "AnimationEvent", { value: AnimationEvent, configurable: true });
}
