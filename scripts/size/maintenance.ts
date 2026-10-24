// Measurement entry for scripts/size.mjs: what a page pays for the status module alone.
import { init, maintenance } from "../../src/browser";

init({ dsn: "https://key@get.trapp.build/1", modules: [maintenance()] });
