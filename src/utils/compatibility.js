function computeScore(userA, userB) {
  let score = 0;

  // Hobbies — 50%
  const hobbiesA = userA.hobbies || [];
  const hobbiesB = userB.hobbies || [];
  if (hobbiesA.length > 0 && hobbiesB.length > 0) {
    const common = hobbiesA.filter((h) => hobbiesB.includes(h));
    const union = [...new Set([...hobbiesA, ...hobbiesB])];
    score += (common.length / union.length) * 50;
  }

  // Âge — 20%
  const ageDiff = Math.abs((userA.age || 25) - (userB.age || 25));
  if (ageDiff === 0) score += 20;
  else if (ageDiff <= 2) score += 16;
  else if (ageDiff <= 5) score += 12;
  else if (ageDiff <= 10) score += 6;
  else score += 0;

  // Ville — 20%
  if (userA.city && userB.city) {
    if (userA.city.toLowerCase() === userB.city.toLowerCase()) {
      score += 20;
    } else {
      score += 0;
    }
  }

  // Langue — 10%
  if ((userA.language || "fr") === (userB.language || "fr")) {
    score += 10;
  }

  return Math.round(score);
}

module.exports = { computeScore };
