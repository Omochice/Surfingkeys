import browser from "@sk/adapter/browser";
import { reportOnFail } from "@sk/common/result";
import { reportError } from "@sk/core/report";
import { hide, setSanitizedContent, show } from "@sk/core/utils";
import { RUNTIME } from "@sk/messaging/runtime";

reportOnFail(
  RUNTIME("getTopSites", null, (response: { urls: { url: string; title: string }[] }) => {
    const urls = response.urls.map((u: { url: string; title: string }) => {
      const favUrl = browser.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(u.url)}`);
      return `<li><a href="${u.url}"><i style="background:url(${favUrl}) no-repeat"></i>${u.title}</a></li>`;
    });
    setSanitizedContent(document.querySelector("#topSites>ul")!, urls.join("\n"));

    const screen1 = document.querySelector<HTMLElement>("#screen1")!;
    show(screen1);
    screen1.classList.add("fadeIn");

    const screen2 = document.querySelector<HTMLElement>("#screen2")!;

    document.getElementById("back")!.onclick = () => {
      const cl = screen2.classList;
      cl.remove("fadeOut");
      cl.remove("fadeIn");
      cl.add("fadeOut");
      screen2.addEventListener(
        "animationend",
        () => {
          hide(screen2);
          show(screen1);
          screen1.classList.add("fadeIn");
        },
        { once: true },
      );
    };

    document.querySelector<HTMLElement>("#show-full-list-of-surfingkeys>a")!.onclick = () => {
      const cl = screen1.classList;
      cl.remove("fadeOut");
      cl.remove("fadeIn");
      cl.add("fadeOut");
      screen1.addEventListener(
        "animationend",
        () => {
          hide(screen1);
          show(screen2);
          screen2.classList.add("fadeIn");
        },
        { once: true },
      );
    };
  }),
  reportError,
);

document.addEventListener("surfingkeys:userSettingsLoaded", (evt) => {
  const { getUsage } = (evt as CustomEvent).detail;
  getUsage((usage: string) => {
    const usageElement = document.getElementById("sk_usage")!;
    setSanitizedContent(usageElement, usage);
    const keys = Array.from(usageElement.querySelectorAll("div")).filter((d) => {
      return d.firstElementChild!.matches(".kbd-span");
    });
    const randomTip = document.getElementById("randomTip")!;
    setInterval(() => {
      const i = Math.floor((Math.random() * 100_000) % keys.length);
      const cl = randomTip.classList;
      cl.remove("fadeOut");
      cl.remove("fadeIn");
      cl.add("fadeOut");
      const tip = keys[i];
      if (tip == null) {
        return;
      }
      randomTip.addEventListener(
        "animationend",
        () => {
          setSanitizedContent(randomTip, tip.innerHTML);
          randomTip.classList.add("fadeIn");
        },
        { once: true },
      );
    }, 5000);
  });
});
