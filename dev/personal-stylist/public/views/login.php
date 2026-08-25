<?php /** @var string|null $error */ ?>
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AS IF — Sign in</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,600&family=DM+Sans:wght@400;500;600&display=swap">
<link rel="stylesheet" href="<?= e(PS_BASE) ?>/assets/app.css">
</head>
<body class="auth">
  <main class="card">
    <h1 class="wordmark">AS <em>IF</em></h1>
    <p class="tag">Your wardrobe</p>
    <?php if ($error): ?><p class="error"><?= e($error) ?></p><?php endif; ?>
    <form method="post" action="<?= e(PS_BASE) ?>/login">
      <input type="hidden" name="csrf" value="<?= e(Csrf::token()) ?>">
      <label>Email
        <input type="email" name="email" required autocomplete="username" autofocus>
      </label>
      <label>Password
        <input type="password" name="password" required autocomplete="current-password">
      </label>
      <button type="submit">Sign in</button>
    </form>
  </main>
</body>
</html>
