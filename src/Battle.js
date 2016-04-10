import Monster from './entities/Monster';
import createRegex from './helpers/createRegex';
import commands from './Commands.json';

const ATTACK_REGEX = createRegex(commands.attack, true);
const DODGE_REGEX = createRegex(commands.dodge, false);

const PLAYER_HIT_PROBABILITY = 0.9;
const MONSTER_HIT_PROBABILITY = 0.9;
const MONSTER_HIT_WHILE_PLAYER_DODGE_PROBABILITY = 0.1;

/**
 * A Battle Class
 * Maintains the Battle state. How many monsters, their hit points, who they're
 * targeting, when they attack, interpreting the user's attacks, etc.
 */
export default class Battle {
  constructor(props) {
    this.entityManager = props.entityManager;
    // speed is probably the wrong word, because this is the opposite... can
    // specify after how much user interaction monsters strike back. when curCount
    // reaches speed, we strike back
    this.speed = props.speed || 1;
    this.curCount = 0;
    // an array of monsters in this battle, when the length is 0, the user has won!
    this.monsters = [];
    // we maintain a map of playerids --> how often they attack. this affects how
    // likely they are to be targeted. we also maintain the total # of attacks.
    this.playerHitMap = {};
    this.totalHits = 0;
    // a reference to the monster that's "gearing up" and who it's targeting
    this.gearingUpMonster = null;
    this.gearingUpTarget = null;
    // iterate over our monster map and create a bunch of monsters!
    for (const monsterID in props.monsters) {
      if (props.monsters.hasOwnProperty(monsterID)) {
        const monsterprops = this.entityManager.get(monsterID);
        // the value of props (for a given id) is the # of monsters for that id
        for (let i = 0; i < props.monsters[monsterID]; i++) {
          this.monsters.push(new Monster(monsterprops));
        }
      }
    }
  }

  /**
   * This is our Battle execute loop. Handles user attacks, user dodges, and
   * when to have monsters strike back.
   */
  execute(input, respond, player) {
    let somethingHappened = false;
    // the user is attacking!
    if (ATTACK_REGEX.test(input)) {
      this.playerAttempt(input, respond, player);
      somethingHappened = true;
    // the user is dodging!
    } else if (DODGE_REGEX.test(input)) {
      player.setDodge(true);
      respond(`${player.name} is attempting to dodge...`);
      somethingHappened = true;
    }
    // if the attacks or dodges AND we have monsters AND it's time, strike back
    if (somethingHappened && this.monsters.length && ++this.curCount === this.speed) {
      this.handleStrikeBack(respond);
      this.curCount = 0;
    }
    // Area.js keeps calling this on user input until we return true to signify
    // that the battle is over.
    return this.monsters.length === 0;
  }

  /**
   * Handle the "player attack" workflow.
   * First we use some randomness to see hit vs. miss
   * If it's a hit, we find the monster they're going after, and wound them. If
   * that's a fatal wound, we remove the monstah.
   */
  playerAttempt(input, respond, player) {
    const playerID = player._id;
    // first we update our player map and total hits to adjust the probability
    // that this player will be targeted by monsters retaliating
    this.totalHits++;
    const curHits = this.playerHitMap[playerID] || 0;
    this.playerHitMap[playerID] = curHits + 1;
    // this'll be our "pretty response" string. rather than executing a response
    // for each possibility, we concatenate on to this guy to limit # of outputs
    let pretty = '';
    // first we see if this attack attempt is a hit vs a miss
    if (Math.random() < PLAYER_HIT_PROBABILITY) {
      // it's a hit! let's see what we're attempting to hit...
      const monsterAttempt = ATTACK_REGEX.exec(input)[1];
      let found = false;
      for (let i = 0; i < this.monsters.length && !found; i++) {
        const monster = this.monsters[i];
        if (monster.match(monsterAttempt)) {
          // aha! we found a match! let's hurt this bad boi and append our pretty string
          found = true;
          monster.wound();
          pretty += `successfully hit ${monster.name}.`;
          // if this monster is now dead, we remove it from our monsters array
          // also if that monster was "gearing up" we clear it. deads can't attack!
          if (monster.getHP() === 0) {
            if (this.gearingUpMonster && monster._id === this.gearingUpMonster._id) {
              this.gearingUpMonster = null;
            }
            this.monsters.splice(i, 1);
            pretty += ` you killed ${monster.name}!`;
          // if it's just been hurt, append the current HP onto our pretty string
          } else {
            pretty += ` HP remaining: ${monster.getHP()}`;
          }
        }
      }
      // if nothing was found, let our user know
      if (!found) {
        pretty += `no enemy goes by ${monsterAttempt}`;
      }
    // oh no! we missed!
    } else {
      pretty += 'oh noes! you missed!';
    }
    // the player tried to do something, they aint dodgin no more
    if (player.getDodge()) {
      pretty += `\n${player.name} is no longer dodging...`;
    }
    player.setDodge(false);
    // respond with the prettiest string everrrr.
    if (pretty.length) {
      respond(pretty);
    }
  }

  /**
   * Fun method to select a playerID based on how many attempted attacks they
   * have, well, attacked. Their odds of being selected are: their_hits / total
   */
  selectPlayer() {
    const probabilities = [];
    for (const playerID in this.playerHitMap) {
      if (this.playerHitMap.hasOwnProperty((playerID))) {
        probabilities.push({
          playerID,
          p: this.playerHitMap[playerID] / this.totalHits,
        });
      }
    }
    const r = Math.random();
    let total = 0;
    let i = -1;
    do {
      total += probabilities[++i].p;
    } while (i < probabilities.length && total < r);
    return probabilities[i].playerID;
  }

  /**
   * It's our monsters turn.
   * First we select a monster to be "gearing up" and we target a player. When
   * this is called again, that "gearing up" monster strikes!
   */
  handleStrikeBack(respond) {
    // this'll be our "pretty response" string. rather than executing a response
    // for each possibility, we concatenate on to this guy to limit # of outputs
    let pretty = '';
    // if we have a monster in the "gearing up" state and our target is still around,
    // do some attack logic
    if (this.gearingUpMonster && this.gearingUpTarget) {
      const player = this.entityManager.get(this.gearingUpTarget);
      // if the user is in the dodge state, use a different probability to determine hit success
      if (Math.random() < (player.getDodge() ? MONSTER_HIT_WHILE_PLAYER_DODGE_PROBABILITY : MONSTER_HIT_PROBABILITY)) {
        // we hit! wound the player. if the player is now dead, handle that,
        // otherwise just notify the current HP
        player.wound();
        pretty += `${this.gearingUpMonster.name} strikes ${this.entityManager.get(this.gearingUpTarget).name}!`;
        if (player.getHP() === 0) {
          pretty += ` ${player.name} is super dead.`;
          this.handlePlayerDeath(this.gearingUpTarget);
        } else {
          pretty += ` HP remaining: ${player.getHP()}`;
        }
      // our monster missed
      } else {
        pretty += `${this.gearingUpMonster.name} missed!`;
      }
      // the player aint dodgin no more
      if (player.getDodge()) {
        pretty += `\n${player.name} is no longer dodging...`;
      }
      player.setDodge(false);
      // clear this so that we hit the other logic next time
      this.gearingUpMonster = null;
      this.gearingUpTarget = null;
    // otherwise we select a random monster and a randomish player for next time
    } else {
      this.gearingUpMonster = this.monsters[Math.floor(Math.random() * this.monsters.length)];
      this.gearingUpTarget = this.selectPlayer();
      pretty += `${this.gearingUpMonster.name} is looking at ${this.entityManager.get(this.gearingUpTarget).name}`;
    }
    // respond with the prettiest string everrrr.
    if (pretty) {
      respond(pretty);
    }
  }

  /** When a player dies, removing it from our hit map and do other cleanup */
  handlePlayerDeath(playerID) {
    this.totalHits -= this.playerHitMap[playerID];
    delete this.playerHitMap[playerID];
    if (this.gearingUpTarget === playerID) {
      this.gearingUpTarget = null;
    }
  }

  /** Make a pretty string describing this battle */
  describe() {
    let pretty = '';
    for (const monster of this.monsters) {
      pretty += `${monster.describe()}\n`;
    }
    return pretty;
  }
}
