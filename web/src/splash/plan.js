(() => {
  if (!matchMedia("(pointer: coarse) and (hover: none)").matches || Math.min(screen.width, screen.height) > 600) return;
  const hour = new Date().getHours();
  const variant = hour >= 17 && hour < 23 ? "home" : hour >= 4 && hour < 17 ? "meadow" : "sunset";
  const load = (name) => {
    const image = new Image();
    image.src = `/splash/${name}.png`;
    return image.decode().then(() => image);
  };
  const images = Promise.all([load("cat"), load(variant), load("text")]);
  images.catch(() => {});
  window.webgbaSplashPlan = { variant, images };
})();
