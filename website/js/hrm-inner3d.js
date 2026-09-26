(() => {
  "use strict";
  const body=document.body;
  if(!body || body.classList.contains("home-v2")) return;
  const hero=document.querySelector(".document-hero");
  if(!hero) return;
  body.classList.add("inner-v3d");

  const orb=document.createElement("span");
  orb.className="inner-orb";
  orb.setAttribute("aria-hidden","true");
  hero.append(orb);

  const reduced=window.matchMedia("(prefers-reduced-motion: reduce)");
  if(!reduced.matches){
    window.addEventListener("pointermove",(event)=>{
      const x=(event.clientX/window.innerWidth-.5)*2;
      const y=(event.clientY/window.innerHeight-.5)*2;
      body.style.setProperty("--inner-x",x.toFixed(3));
      body.style.setProperty("--inner-y",y.toFixed(3));
    },{passive:true});
  }

  // Never hide the main document body. Long prose sections can be taller than
  // the viewport, making a percentage-based IntersectionObserver threshold
  // impossible to satisfy and leaving the entire article permanently invisible.
  const targets=document.querySelectorAll(".archive-entry, .agent-caveat, .contact-note");
  if(!reduced.matches && "IntersectionObserver" in window){
    const io=new IntersectionObserver((entries)=>{
      for(const entry of entries){
        if(entry.isIntersecting){
          entry.target.classList.add("is-visible");
          io.unobserve(entry.target);
        }
      }
    },{threshold:0,rootMargin:"0px 0px -5% 0px"});
    targets.forEach((el)=>{el.classList.add("inner-reveal");io.observe(el);});
  }
})();