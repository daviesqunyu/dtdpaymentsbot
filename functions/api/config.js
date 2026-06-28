import { getStoreConfig, json } from "../lib/store.js";

export async function onRequestGet(context) {
  return json(getStoreConfig(context.env));
}
