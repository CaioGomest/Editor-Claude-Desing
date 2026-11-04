<?php
// Server-side file operations for the SCP Motion Editor. Replaces the
// File System Access API (which needs a folder-picker permission dance
// per browser session) with plain fetch() calls the PHP dev server can
// just... do. Every write stays inside editor/projects/ — every path
// coming from the client is validated before touching the filesystem.

header('Content-Type: application/json; charset=utf-8');

$PROJECTS_DIR = realpath(__DIR__ . '/projects');
if ($PROJECTS_DIR === false) {
    http_response_code(500);
    echo json_encode(['ok' => false, 'error' => 'pasta projects/ não encontrada no servidor']);
    exit;
}

function fail($msg, $code = 400) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

function ok($data = []) {
    echo json_encode(array_merge(['ok' => true], $data));
    exit;
}

// Project slugs: letters, digits, - and _ only — this is what stands
// between user input and a path like "../../../whatever".
function safeSlug($s) {
    if (!is_string($s) || !preg_match('/^[a-zA-Z0-9_-]{1,100}$/', $s)) return null;
    return $s;
}

// Filenames: basename() strips any directory components, then we only
// accept a conservative charset — no "..", no slashes, nothing clever.
function safeFilename($s) {
    if (!is_string($s)) return null;
    $s = basename($s);
    if ($s === '' || $s === '.' || $s === '..') return null;
    if (!preg_match('/^[a-zA-Z0-9 _.\x{00C0}-\x{024F}-]{1,150}$/u', $s)) return null;
    return $s;
}

// Resolves projects/<dir>, refusing to leave $PROJECTS_DIR even if some
// check above had a gap — realpath() + strpos is the actual boundary.
function projectDirPath($dir, $mustExist = true) {
    global $PROJECTS_DIR;
    $slug = safeSlug($dir);
    if (!$slug) fail('nome de projeto inválido');
    $path = $PROJECTS_DIR . '/' . $slug;
    if ($mustExist) {
        $real = realpath($path);
        if ($real === false || strpos($real, $PROJECTS_DIR) !== 0) fail('projeto não encontrado', 404);
        return $real;
    }
    return $path;
}

// All export output (PNG sequences, assembled/recorded MP4s) lives under
// one shared projects/exports/<dir>/ tree instead of inside each project's
// own folder — keeps that folder to just project.json + assets/.
function exportsDirPath($dirSlug) {
    global $PROJECTS_DIR;
    $path = $PROJECTS_DIR . '/exports/' . $dirSlug;
    if (!is_dir($path)) mkdir($path, 0777, true);
    return $path;
}

function readManifest() {
    global $PROJECTS_DIR;
    $f = $PROJECTS_DIR . '/projects.json';
    if (!file_exists($f)) return [];
    $data = json_decode(file_get_contents($f), true);
    return is_array($data) ? $data : [];
}

function writeManifest($manifest) {
    global $PROJECTS_DIR;
    file_put_contents(
        $PROJECTS_DIR . '/projects.json',
        json_encode(array_values($manifest), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)
    );
}

function writeJson($path, $data) {
    file_put_contents($path, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}

function rrmdir($dir) {
    if (!is_dir($dir)) return;
    foreach (scandir($dir) as $item) {
        if ($item === '.' || $item === '..') continue;
        $path = $dir . '/' . $item;
        if (is_dir($path) && !is_link($path)) rrmdir($path); else unlink($path);
    }
    rmdir($dir);
}

// Runs a command as an argument array via proc_open with bypass_shell — on
// Windows this calls the .exe directly instead of routing through cmd.exe,
// which would otherwise try to expand any "%..." in the arguments (like the
// ffmpeg frame-number pattern "frame_%05d.png") as an environment variable
// and silently eat it. Returns [exitCode, combinedOutput].
function runProcess($exe, array $args) {
    // stderr goes to a FILE, not a pipe: ffmpeg logs its progress there
    // continuously, and reading stdout-to-completion first (below) while
    // nobody drains a stderr pipe deadlocks the moment that pipe's OS
    // buffer fills — the child blocks writing, we block reading, forever.
    $errFile = tempnam(sys_get_temp_dir(), 'ffmpeg_err_');
    $descriptors = [0 => ['pipe', 'r'], 1 => ['pipe', 'w'], 2 => ['file', $errFile, 'w']];
    // @: a missing candidate (e.g. plain "ffmpeg" when it's not on PATH) is
    // an expected, handled failure here — resolveFfmpeg() tries the next
    // one. Without this, Xdebug's warning HTML leaks into the JSON body.
    $proc = @proc_open(array_merge([$exe], $args), $descriptors, $pipes, null, null, ['bypass_shell' => true]);
    if (!is_resource($proc)) { @unlink($errFile); return [1, 'não consegui iniciar "' . $exe . '"']; }
    fclose($pipes[0]);
    $stdout = stream_get_contents($pipes[1]);
    fclose($pipes[1]);
    $code = proc_close($proc);
    $stderr = @file_get_contents($errFile);
    @unlink($errFile);
    return [$code, trim($stdout . "\n" . ($stderr === false ? '' : $stderr))];
}

// Tries the bare command first (works once PATH picks it up, e.g. after a
// reboot), then known install spots across the dev machine and this host.
function resolveFfmpeg() {
    static $cached = null;
    if ($cached !== null) return $cached ?: null;
    $home = getenv('HOME');
    $candidates = [
        'ffmpeg',
        'C:\\Users\\Pichau\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.1-full_build\\bin\\ffmpeg.exe',
        $home ? $home . '/bin/ffmpeg' : null,
        '/home/u214219698/bin/ffmpeg',
    ];
    if (!canExecDirectly()) {
        // Can't proc_open a "-version" probe to test these — just hand back
        // the first one that exists as a file; the cron runner (a real
        // shell, not PHP) is what actually executes it, and fails loudly
        // into the job's own log if the path is wrong.
        foreach ($candidates as $c) {
            if ($c && ($c[0] === '/' || strpos($c, ':\\') !== false) && is_file($c)) { $cached = $c; return $c; }
        }
        $cached = false;
        return null;
    }
    foreach ($candidates as $c) {
        if (!$c) continue;
        [$code] = runProcess($c, ['-version']);
        if ($code === 0) { $cached = $c; return $c; }
    }
    $cached = false;
    return null;
}

// Some hosts (this one included) disable proc_open/exec/shell_exec entirely
// in php.ini for security — in both the web (LiteSpeed) and CLI SAPIs. When
// that's the case ffmpeg jobs are queued as plain shell-command files instead
// of run inline; a cron job (a real OS process, outside PHP's sandbox) picks
// them up. See assemble_video / finalize_recording / job_status below.
function canExecDirectly() {
    return function_exists('proc_open');
}

function jobsDir($exportsDir, $sub) {
    $path = $exportsDir . '/jobs/' . $sub;
    if (!is_dir($path)) mkdir($path, 0777, true);
    return $path;
}

// Queues a shell command for the cron runner (cron/process-jobs.sh) instead
// of executing it inline. Each argument is escapeshellarg'd individually, so
// this is exactly as safe against injection as the proc_open path — nothing
// here is string-concatenated from unescaped input.
// $tmpOut/$finalOut (optional): when set, appends a shell "&& mv tmp final"
// onto the queued command — ffmpeg jobs write to a leading-dot temp name
// while encoding (see assemble_video/finalize_recording) so list_exports()'s
// glob('*.mp4') never exposes a half-written file as a finished export; the
// rename only happens once ffmpeg has actually exited 0.
function queueJob($exportsDir, $exe, array $args, $tmpOut = null, $finalOut = null) {
    $jobId = bin2hex(random_bytes(8));
    $parts = [escapeshellarg($exe)];
    foreach ($args as $a) $parts[] = escapeshellarg($a);
    $cmd = implode(' ', $parts);
    if ($tmpOut !== null && $finalOut !== null) {
        $cmd .= ' && mv ' . escapeshellarg($tmpOut) . ' ' . escapeshellarg($finalOut);
    }
    $cmd .= "\n";
    file_put_contents(jobsDir($exportsDir, 'pending') . '/' . $jobId . '.cmd', $cmd);
    return $jobId;
}

// Sanitizes a zip entry's relative path into safe path segments, or null
// to reject the entry (any ".."/empty segment anywhere in it).
function safeRelPath($rel) {
    $parts = explode('/', $rel);
    $out = [];
    foreach ($parts as $p) {
        if ($p === '' || $p === '.' || $p === '..') return null;
        if (!preg_match('/^[a-zA-Z0-9 _.\x{00C0}-\x{024F}-]{1,150}$/u', $p)) return null;
        $out[] = $p;
    }
    return $out;
}

$action = $_POST['action'] ?? $_GET['action'] ?? '';

switch ($action) {

    case 'save_project': {
        $path = projectDirPath($_POST['dir'] ?? '');
        $json = $_POST['project'] ?? '';
        $data = json_decode($json, true);
        if ($data === null) fail('JSON inválido');
        writeJson($path . '/project.json', $data);
        ok();
        break;
    }

    case 'upload_asset': {
        $path = projectDirPath($_POST['dir'] ?? '');
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) fail('nenhum arquivo enviado');
        $orig = safeFilename($_FILES['file']['name']);
        if (!$orig) fail('nome de arquivo inválido');
        $assetsDir = $path . '/assets';
        if (!is_dir($assetsDir)) mkdir($assetsDir, 0777, true);

        $dot = strrpos($orig, '.');
        $base = $dot !== false ? substr($orig, 0, $dot) : $orig;
        $ext = $dot !== false ? substr($orig, $dot) : '';
        $name = $orig;
        for ($i = 2; file_exists($assetsDir . '/' . $name); $i++) $name = $base . '-' . $i . $ext;

        if (!move_uploaded_file($_FILES['file']['tmp_name'], $assetsDir . '/' . $name)) {
            fail('falha ao gravar o arquivo', 500);
        }
        ok(['file' => $name]);
        break;
    }

    case 'delete_project': {
        // Soft delete: move to projects/.trash/ instead of erasing outright,
        // so a wrong click (or a few of them) doesn't destroy real work.
        $dir = $_POST['dir'] ?? '';
        $path = projectDirPath($dir);
        global $PROJECTS_DIR;
        $trash = $PROJECTS_DIR . '/.trash';
        if (!is_dir($trash)) mkdir($trash, 0777, true);
        $dest = $trash . '/' . $dir . '_' . date('Ymd_His');
        $n = 2;
        while (file_exists($dest)) { $dest = $trash . '/' . $dir . '_' . date('Ymd_His') . '_' . $n; $n++; }
        if (!rename($path, $dest)) fail('falha ao mover para a lixeira', 500);
        $manifest = readManifest();
        $manifest = array_filter($manifest, function ($m) use ($dir) { return ($m['dir'] ?? '') !== $dir; });
        writeManifest($manifest);
        ok();
        break;
    }

    case 'rename_project': {
        $id = $_POST['id'] ?? '';
        $title = trim($_POST['title'] ?? '');
        if ($title === '') fail('título vazio');
        $manifest = readManifest();
        $foundDir = null;
        foreach ($manifest as &$m) {
            if (($m['id'] ?? '') === $id) { $m['title'] = $title; $foundDir = $m['dir'] ?? null; break; }
        }
        unset($m);
        if (!$foundDir) fail('projeto não encontrado', 404);
        writeManifest($manifest);

        $pf = projectDirPath($foundDir) . '/project.json';
        if (file_exists($pf)) {
            $data = json_decode(file_get_contents($pf), true);
            if (is_array($data)) {
                if (!isset($data['meta']) || !is_array($data['meta'])) $data['meta'] = [];
                $data['meta']['title'] = $title;
                writeJson($pf, $data);
            }
        }
        ok();
        break;
    }

    case 'export_zip': {
        // Inverse of import_zip: a folder the importer will accept
        // ({slug}/{slug}.project.json + assets), so it can go to Claude
        // Code (or anyone) and come back through "Importar ZIP".
        set_time_limit(0);
        if (!class_exists('ZipArchive')) fail('ZipArchive não disponível neste PHP', 500);
        $path = projectDirPath($_GET['dir'] ?? $_POST['dir'] ?? '');
        $slug = basename($path);
        $projectJson = $path . '/project.json';
        if (!file_exists($projectJson)) fail('project.json não encontrado', 404);

        $tmp = tempnam(sys_get_temp_dir(), 'projzip_');
        @unlink($tmp);
        $tmp .= '.zip';
        $zip = new ZipArchive();
        if ($zip->open($tmp, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
            fail('falha ao criar o zip', 500);
        }
        $zip->addFile($projectJson, $slug . '/' . $slug . '.project.json');

        $iter = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($path, FilesystemIterator::SKIP_DOTS)
        );
        foreach ($iter as $file) {
            if (!$file->isFile()) continue;
            $full = $file->getPathname();
            $rel = substr($full, strlen($path) + 1);
            $rel = str_replace('\\', '/', $rel);
            if (strcasecmp($rel, 'project.json') === 0) continue;
            $safeParts = safeRelPath($rel);
            if (!$safeParts) continue;
            $zip->addFile($full, $slug . '/' . implode('/', $safeParts));
        }
        $zip->close();
        if (!file_exists($tmp) || filesize($tmp) < 1) fail('zip ficou vazio', 500);

        $exportsDir = exportsDirPath($slug);
        $outName = $slug . '.zip';
        $outFile = $exportsDir . '/' . $outName;
        if (file_exists($outFile)) @unlink($outFile);
        if (!rename($tmp, $outFile)) {
            if (!copy($tmp, $outFile)) { @unlink($tmp); fail('falha ao gravar o zip', 500); }
            @unlink($tmp);
        }
        ok(['url' => 'projects/exports/' . $slug . '/' . $outName, 'filename' => $outName]);
    }

    case 'import_zip': {
        if (!isset($_FILES['zip']) || $_FILES['zip']['error'] !== UPLOAD_ERR_OK) fail('nenhum arquivo enviado');
        $zip = new ZipArchive();
        if ($zip->open($_FILES['zip']['tmp_name']) !== true) fail('zip inválido');
        global $PROJECTS_DIR;

        $projectJsonPaths = [];
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $name = $zip->getNameIndex($i);
            if (preg_match('/\.project\.json$/', $name)) $projectJsonPaths[] = $name;
        }
        if (!$projectJsonPaths) { $zip->close(); fail('nenhum *.project.json encontrado no zip'); }

        $manifest = readManifest();
        $imported = [];

        foreach ($projectJsonPaths as $jsonPath) {
            $rootPrefix = substr($jsonPath, 0, strrpos($jsonPath, '/') + 1);
            $projectData = json_decode($zip->getFromName($jsonPath), true);
            $slug = safeSlug($projectData['meta']['id'] ?? null);
            if (!$slug) $slug = safeSlug(preg_replace('#/$#', '', $rootPrefix));
            if (!$slug) continue;
            $title = (is_array($projectData) && isset($projectData['meta']['title'])) ? $projectData['meta']['title'] : $slug;

            $destDir = $PROJECTS_DIR . '/' . $slug;
            if (!is_dir($destDir)) mkdir($destDir, 0777, true);

            for ($i = 0; $i < $zip->numFiles; $i++) {
                $name = $zip->getNameIndex($i);
                if (strpos($name, $rootPrefix) !== 0 || substr($name, -1) === '/') continue;
                // Multiple *.project.json siblings can share this same
                // folder (a multi-part video) — only this one's own file
                // goes in, not the other parts' project.json.
                if (preg_match('/\.project\.json$/', $name) && $name !== $jsonPath) continue;
                $rel = substr($name, strlen($rootPrefix));
                if ($rel === '') continue;
                $rel = ($name === $jsonPath) ? 'project.json' : $rel;
                $safeParts = safeRelPath($rel);
                if (!$safeParts) continue;
                $destFile = $destDir . '/' . implode('/', $safeParts);
                $destSub = dirname($destFile);
                if (!is_dir($destSub)) mkdir($destSub, 0777, true);
                file_put_contents($destFile, $zip->getFromName($name));
            }

            $entry = ['id' => $slug, 'title' => $title, 'dir' => $slug];
            $found = false;
            foreach ($manifest as &$m) {
                if (($m['id'] ?? '') === $slug) { $m = $entry; $found = true; break; }
            }
            unset($m);
            if (!$found) $manifest[] = $entry;
            $imported[] = $entry;
        }
        $zip->close();
        writeManifest($manifest);
        ok(['imported' => $imported]);
        break;
    }

    case 'list_assets': {
        $path = projectDirPath($_POST['dir'] ?? $_GET['dir'] ?? '');
        $assetsDir = $path . '/assets';
        $files = [];
        if (is_dir($assetsDir)) {
            foreach (scandir($assetsDir) as $f) {
                if ($f === '.' || $f === '..') continue;
                if (is_file($assetsDir . '/' . $f)) $files[] = $f;
            }
            sort($files);
        }
        ok(['files' => $files]);
        break;
    }

    case 'list_exports': {
        $projectPath = projectDirPath($_GET['dir'] ?? $_POST['dir'] ?? '');
        $dirSlug = basename($projectPath);
        $exportsDir = $PROJECTS_DIR . '/exports/' . $dirSlug;
        $files = [];
        if (is_dir($exportsDir)) {
            foreach (glob($exportsDir . '/*.mp4') ?: [] as $f) {
                $files[] = [
                    'name' => basename($f),
                    'url' => 'projects/exports/' . $dirSlug . '/' . basename($f),
                    'size' => filesize($f),
                    'mtime' => filemtime($f),
                ];
            }
            usort($files, function ($a, $b) { return $b['mtime'] - $a['mtime']; });
        }
        ok(['files' => $files]);
    }

    case 'export_frame': {
        // dir/folder/filename come from the query string so the request body
        // can be the raw image bytes (avoids PHP's upload_max_filesize, which
        // only applies to multipart $_FILES and silently drops ~3MB PNGs).
        $projectPath = projectDirPath($_GET['dir'] ?? $_POST['dir'] ?? '');
        $dirSlug = basename($projectPath);
        $folder = safeFilename($_GET['folder'] ?? $_POST['folder'] ?? '');
        $filename = safeFilename($_GET['filename'] ?? $_POST['filename'] ?? '');
        if (!$folder || !$filename) fail('parâmetros inválidos');
        $outDir = exportsDirPath($dirSlug) . '/' . $folder;
        if (!is_dir($outDir)) mkdir($outDir, 0777, true);

        $raw = file_get_contents('php://input');
        if (is_string($raw) && $raw !== '') {
            if (file_put_contents($outDir . '/' . $filename, $raw) === false) {
                fail('falha ao gravar o quadro', 500);
            }
            ok();
        }

        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            $code = $_FILES['file']['error'] ?? -1;
            $hints = [
                UPLOAD_ERR_INI_SIZE => 'quadro maior que o limite do PHP (upload_max_filesize=' . ini_get('upload_max_filesize') . ')',
                UPLOAD_ERR_FORM_SIZE => 'quadro maior que o limite do formulário',
                UPLOAD_ERR_PARTIAL => 'upload incompleto',
                UPLOAD_ERR_NO_FILE => 'nenhum arquivo enviado',
            ];
            fail($hints[$code] ?? ('nenhum arquivo enviado (código ' . $code . ')'));
        }
        if (!move_uploaded_file($_FILES['file']['tmp_name'], $outDir . '/' . $filename)) {
            fail('falha ao gravar o quadro', 500);
        }
        ok();
        break;
    }

    case 'assemble_video': {
        set_time_limit(0); // long videos can take a while to encode
        $projectPath = projectDirPath($_POST['dir'] ?? '');
        $dirSlug = basename($projectPath);
        $folder = safeFilename($_POST['folder'] ?? '');
        $fps = isset($_POST['fps']) ? (int) $_POST['fps'] : 30;
        if (!$folder || $fps < 1) fail('parâmetros inválidos');
        $exportsDir = exportsDirPath($dirSlug);
        $framesDir = $exportsDir . '/' . $folder;
        $pngs = is_dir($framesDir) ? glob($framesDir . '/frame_*.png') : [];
        $jpgs = is_dir($framesDir) ? glob($framesDir . '/frame_*.jpg') : [];
        if (!$pngs && !$jpgs) {
            fail('pasta de quadros "' . $folder . '" não encontrada (exporte a sequência primeiro)', 404);
        }
        $framePattern = $jpgs ? $framesDir . '/frame_%05d.jpg' : $framesDir . '/frame_%05d.png';

        $ffmpeg = resolveFfmpeg();
        if (!$ffmpeg) fail('ffmpeg não encontrado no servidor', 500);

        // First clip of the first audio track (if any) rides along as the soundtrack.
        $audioFile = null;
        $projectData = json_decode(file_get_contents($projectPath . '/project.json'), true);
        foreach (($projectData['tracks'] ?? []) as $t) {
            if (($t['kind'] ?? '') !== 'audio' || empty($t['clips'])) continue;
            $assetId = $t['clips'][0]['asset'] ?? null;
            foreach (($projectData['assets']['audio'] ?? []) as $a) {
                if (($a['id'] ?? '') === $assetId && !empty($a['file'])) {
                    $candidate = $projectPath . '/assets/' . $a['file'];
                    if (file_exists($candidate)) $audioFile = $candidate;
                }
            }
            break;
        }

        $mp4Name = $folder . '_' . date('Ymd_His') . '.mp4';
        $finalOutFile = $exportsDir . '/' . $mp4Name;
        // Written under a leading-dot temp name while ffmpeg encodes — a long
        // video takes many minutes via the cron queue, and list_exports()'s
        // glob('*.mp4') skips dotfiles, so a half-written file is never
        // listed/downloadable as a finished export. Renamed to its real name
        // only once ffmpeg has actually exited 0 (see queueJob / below).
        $outFile = $exportsDir . '/.inprogress_' . $mp4Name;
        $args = ['-y', '-framerate', (string) $fps, '-i', $framePattern];
        if ($audioFile) $args = array_merge($args, ['-i', $audioFile, '-c:a', 'aac', '-shortest']);
        // -threads: without a cap, libx264 auto-detects the host's full CPU
        // count — on a big shared/containerized box (48 cores here) that can
        // exceed what the container actually lets it spawn, and the encoder
        // silently fails to open at all. 4 is safely under any realistic cap.
        // veryfast: default 'medium' preset was slow enough on this shared
        // host (~0.2x realtime) that long exports got killed by the host's
        // resource limiter before finishing, then retried from scratch by
        // the cron queue's stale-lock recovery — an infinite loop that never
        // completes. veryfast trades a bit of compression for much less CPU.
        $args = array_merge($args, ['-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '18', $outFile]);

        if (!canExecDirectly()) {
            $jobId = queueJob($exportsDir, $ffmpeg, $args, $outFile, $finalOutFile);
            ok(['queued' => true, 'jobId' => $jobId, 'url' => 'projects/exports/' . $dirSlug . '/' . $mp4Name, 'audio' => $audioFile !== null]);
        }

        [$code, $log] = runProcess($ffmpeg, $args);
        if ($code !== 0 || !file_exists($outFile)) {
            @unlink($outFile);
            fail('ffmpeg falhou: ' . substr($log, -1500), 500);
        }
        rename($outFile, $finalOutFile);
        ok(['url' => 'projects/exports/' . $dirSlug . '/' . $mp4Name, 'audio' => $audioFile !== null]);
        break;
    }

    case 'job_status': {
        $projectPath = projectDirPath($_GET['dir'] ?? $_POST['dir'] ?? '');
        $dirSlug = basename($projectPath);
        $jobId = safeFilename($_GET['jobId'] ?? $_POST['jobId'] ?? '');
        if (!$jobId) fail('parâmetros inválidos');
        $exportsDir = exportsDirPath($dirSlug);
        $statusFile = jobsDir($exportsDir, 'done') . '/' . $jobId . '.status';
        if (!file_exists($statusFile)) {
            $pendingFile = jobsDir($exportsDir, 'pending') . '/' . $jobId . '.cmd';
            ok(['status' => file_exists($pendingFile) ? 'pending' : 'unknown']);
        }
        $status = trim(file_get_contents($statusFile));
        $logFile = jobsDir($exportsDir, 'done') . '/' . $jobId . '.log';
        $log = file_exists($logFile) ? file_get_contents($logFile) : '';
        ok(['status' => $status === 'ok' ? 'ok' : 'error', 'log' => substr($log, -1500)]);
        break;
    }

    case 'finalize_recording': {
        // The browser records a real-time canvas+audio capture as WebM
        // (MediaRecorder can't produce MP4 directly); this just transcodes
        // that one file to MP4/H.264+AAC, which is fast since it's a normal
        // encode of an already-compressed video, not per-frame rasterizing.
        set_time_limit(0);
        $projectPath = projectDirPath($_POST['dir'] ?? '');
        $dirSlug = basename($projectPath);
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) fail('nenhum arquivo enviado');

        $ffmpeg = resolveFfmpeg();
        if (!$ffmpeg) fail('ffmpeg não encontrado no servidor', 500);

        $exportsDir = exportsDirPath($dirSlug);

        $stamp = date('Ymd_His');
        $webmPath = $exportsDir . '/recording_' . $stamp . '.webm';
        if (!move_uploaded_file($_FILES['file']['tmp_name'], $webmPath)) {
            fail('falha ao gravar o arquivo', 500);
        }

        $mp4Name = 'export_' . $stamp . '.mp4';
        $finalMp4Path = $exportsDir . '/' . $mp4Name;
        // Same leading-dot temp name trick as assemble_video — keeps a
        // still-encoding file out of list_exports()'s glob('*.mp4') until
        // it's actually finished.
        $mp4Path = $exportsDir . '/.inprogress_' . $mp4Name;
        $args = [
            '-y', '-i', $webmPath,
            '-c:v', 'libx264', '-threads', '4', '-pix_fmt', 'yuv420p', '-preset', 'fast', '-crf', '18',
            '-c:a', 'aac', '-b:a', '192k',
            $mp4Path,
        ];

        if (!canExecDirectly()) {
            $jobId = queueJob($exportsDir, $ffmpeg, $args, $mp4Path, $finalMp4Path);
            ok(['queued' => true, 'jobId' => $jobId, 'url' => 'projects/exports/' . $dirSlug . '/' . $mp4Name]);
        }

        [$code, $log] = runProcess($ffmpeg, $args);
        if ($code !== 0 || !file_exists($mp4Path)) {
            @unlink($mp4Path);
            fail('ffmpeg falhou ao converter (webm mantido em ' . basename($webmPath) . ' pra depurar): ' . substr($log, -1500), 500);
        }
        rename($mp4Path, $finalMp4Path);
        @unlink($webmPath);

        ok(['url' => 'projects/exports/' . $dirSlug . '/' . $mp4Name]);
        break;
    }

    default:
        fail('ação desconhecida: ' . $action, 404);
}
