import browser from "./common/browser";
import { RUNTIME } from "./common/runtime";
import { setSanitizedContent } from "./common/utils";

RUNTIME("getTopSites", null, (response) => {
  const urls = response.urls.map((u: { url: string; title: string }) => {
    const favUrl = browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(u.url)}`);
    return `<li><a href="${u.url}"><i style="background:url(${favUrl}) no-repeat"></i>${u.title}</a></li>`;
  });
  setSanitizedContent(document.querySelector("#topSites>ul")!, urls.join("\n"));

  const screen1 = document.querySelector("#screen1") as HTMLElement;
  screen1.show();
  screen1.classList.add("fadeIn");

  const screen2 = document.querySelector("#screen2") as HTMLElement;

  document.getElementById("back")!.onclick = () => {
    const cl = screen2.classList;
    cl.remove("fadeOut");
    cl.remove("fadeIn");
    cl.add("fadeOut");
    screen2.one("animationend", () => {
      screen2.hide();
      screen1.show();
      screen1.classList.add("fadeIn");
    });
  };

  document.querySelector<HTMLElement>("#show-full-list-of-surfingkeys>a")!.onclick = () => {
    const cl = screen1.classList;
    cl.remove("fadeOut");
    cl.remove("fadeIn");
    cl.add("fadeOut");
    screen1.one("animationend", () => {
      screen1.hide();
      screen2.show();
      screen2.classList.add("fadeIn");
    });
  };
});

document.addEventListener("surfingkeys:userSettingsLoaded", (evt) => {
  const { getUsage } = (evt as CustomEvent).detail;
  getUsage((usage: string) => {
    const _usage = document.getElementById("sk_usage")!;
    setSanitizedContent(_usage, usage);
    const keys = Array.from(_usage.querySelectorAll("div")).filter((d) => {
      return d.firstElementChild!.matches(".kbd-span");
    });
    const randomTip = document.getElementById("randomTip")!;
    setInterval(() => {
      const i = Math.floor(((Math.random() * 100000) % keys.length) as number);
      const cl = randomTip.classList;
      cl.remove("fadeOut");
      cl.remove("fadeIn");
      cl.add("fadeOut");
      const tip = keys[i];
      if (tip === undefined) {
        return;
      }
      randomTip.one("animationend", function (this: HTMLElement) {
        setSanitizedContent(this, tip.innerHTML);
        this.classList.add("fadeIn");
      });
    }, 5000);
  });
});
