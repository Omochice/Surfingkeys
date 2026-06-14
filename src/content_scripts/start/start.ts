import browser from "../common/browser";
import { reportError } from "../common/report";
import { RUNTIMEAsync } from "../common/runtime";
import { hide, once, setSanitizedContent, show } from "../common/utils";

// RUNTIMEAsync rejects with the ChromeRuntimeError (after it has already been reported); catching
// here keeps the previous reportOnFail presentation while preventing an unhandled rejection.
RUNTIMEAsync<{ urls: { url: string; title: string }[] }>("getTopSites")
  .then((response) => {
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
      once(screen2, "animationend", () => {
        hide(screen2);
        show(screen1);
        screen1.classList.add("fadeIn");
      });
    };

    document.querySelector<HTMLElement>("#show-full-list-of-surfingkeys>a")!.onclick = () => {
      const cl = screen1.classList;
      cl.remove("fadeOut");
      cl.remove("fadeIn");
      cl.add("fadeOut");
      once(screen1, "animationend", () => {
        hide(screen1);
        show(screen2);
        screen2.classList.add("fadeIn");
      });
    };
  })
  .catch(reportError);

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
      const i = Math.floor((Math.random() * 100_000) % keys.length);
      const cl = randomTip.classList;
      cl.remove("fadeOut");
      cl.remove("fadeIn");
      cl.add("fadeOut");
      const tip = keys[i];
      if (tip == null) {
        return;
      }
      once(randomTip, "animationend", function (this: HTMLElement) {
        setSanitizedContent(this, tip.innerHTML);
        this.classList.add("fadeIn");
      });
    }, 5000);
  });
});
