/* Ena vstopna tocka za knjiznice (gostimo jih sami v vendor/, brez CDN-ja in brez builda).
   Preact + htm: komponente se pisejo kot html`<div>...</div>` (predloga, ne innerHTML -
   vse vrednosti gredo v DOM kot besedilo ali atribut, zato XSS iz podatkov ni mogoc). */
import { h, render, Fragment } from "/vendor/preact-10.29.8.module.js";
import {
  useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect
} from "/vendor/preact-hooks-10.29.8.module.js";
import htm from "/vendor/htm-3.1.1.module.js";

export const html = htm.bind(h);
export { h, render, Fragment, useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect };
