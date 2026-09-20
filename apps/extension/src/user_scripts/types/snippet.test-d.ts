api.mapkey("<Ctrl-y>", "Show me the money", () => {
  api.Front.showPopup("a well-known phrase uttered by characters in the 1996 film Jerry Maguire");
});
api.map("gt", "T");
api.Hints.style("border: solid 3px #552a48;", "text");

settings.hintAlign = "left";
settings.scrollStepSize = 140;

// @ts-expect-error -- a value outside the documented set is rejected
settings.hintAlign = "top";
// @ts-expect-error -- a key the README does not document is rejected
settings.noSuchSetting = true;
// @ts-expect-error -- an api member the user script path lacks is rejected
api.noSuchFunction();

export {};
