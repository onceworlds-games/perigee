// Boot: poster mode for store art, or the game.
import './style.css';

const params = new URLSearchParams(location.search);
if (params.get('poster')) {
  import('./poster.js').then((m) => m.run(params.get('poster'))).catch((e) => console.error(e));
} else {
  import('./game/app.js')
    .then(({ App }) => new App(params).start())
    .catch((e) => console.error(e));
}
