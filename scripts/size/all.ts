// Measurement entry for scripts/size.mjs: every module together, as a non-React app would load them.
import { errors, init, maintenance, metrika, recordings } from "../../src/browser";

init({ dsn: "https://key@get.trapp.build/1", modules: [errors(), maintenance(), metrika(), recordings()] });
