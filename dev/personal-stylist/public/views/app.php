<?php
declare(strict_types=1);

// Prove the stack end-to-end: read seeded homes + item count from MySQL.
$locations = Db::conn()->query('SELECT name FROM locations ORDER BY id')->fetchAll(PDO::FETCH_COLUMN);
$itemCount = (int) Db::conn()->query('SELECT COUNT(*) FROM items')->fetchColumn();
$baseline  = Db::conn()->query("SELECT `value` FROM settings WHERE `key` = 'effort_baseline'")->fetchColumn() ?: '—';
?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>AS IF</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600&family=DM+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="<?= e(PS_BASE) ?>/assets/app.css">
</head>
<body>
  <header class="top">
    <div><span class="wordmark" style="font-size:22px">AS <em>IF</em></span></div>
    <a href="<?= e(PS_BASE) ?>/logout">Sign out</a>
  </header>

  <main class="wrap">
    <section class="panel">
      <h2>The stack is live.</h2>
      <div class="kv"><span>Signed in</span><span class="v ok">yes</span></div>
      <div class="kv"><span>Database</span><span class="v ok">connected</span></div>
      <div class="kv"><span>Your homes</span><span class="v"><?= e(implode(' · ', $locations) ?: 'none seeded') ?></span></div>
      <div class="kv"><span>Wardrobe items</span><span class="v"><?= $itemCount ?></span></div>
      <div class="kv"><span>Everyday floor</span><span class="v"><?= e(ucfirst((string) $baseline)) ?></span></div>
    </section>

    <section class="panel">
      <h2>Next: add your clothes.</h2>
      <p class="muted">Phase&nbsp;1 foundation is in place — auth, database, secure config. The
      wardrobe capture screen (photograph &amp; tag your clothes, set their home and wash state)
      is the next increment, then the classy daily view wires to this real data.</p>
    </section>
  </main>
</body>
</html>
