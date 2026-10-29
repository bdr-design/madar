<?php
declare(strict_types=1);
// One-time bootstrap for the owner-controlled Hostinger Cron job.
$home = getenv("HOME");
if (!is_string($home) || preg_match("~^/home/[A-Za-z0-9_-]+$~D", $home) !== 1) throw new RuntimeException("Unexpected hosting account directory");
$d = $home."/domains/badrix.com/badrix-sync";
$b = "https://raw.githubusercontent.com/bdr-design/madar/5c108d0aab3cf478a4cb60895083d91fc7de7975/.badrix/hostinger-publisher/";
$files = [
    "README-AR.md"=>"50c10053feacda4e34f0118a7cdb63833af7c558fe3e2c215c6d344f4708b508",
    "config.json"=>"29d1f0da8dc32a3d5ff17df3d610561d2da16cb5f14d2d316451708765a545fc",
    "core.php"=>"2f1484bb0eecae02082703004225c6b41f319e84ff6bea45aa32c96522187185",
    "curated-ledger.json"=>"b034a185406a6690b23e52ae778624314ac81ac3cb85609215a88815da1c21c6",
    "fixtures.json"=>"415ed460a1766d5547c276dc84ca566f85b5f4a13d13a4c60b4be57c47979ae2",
    "sources.json"=>"f31a096b18547646e9f8e9bd107f8ae00b5e2c702fbc52bddcefe306717039c3",
    "sync.php"=>"5b71898c1166e93c01e92d772364fb70224a484c6b4b86a84f9bce086c7e23fa"
];
if (!is_dir($d) && !mkdir($d,0700,true)) throw new RuntimeException("Install directory failed");
foreach ($files as $name=>$expected) {
    $handle = curl_init($b.$name);
    curl_setopt_array($handle,[CURLOPT_RETURNTRANSFER=>true,CURLOPT_FAILONERROR=>true,CURLOPT_CONNECTTIMEOUT=>8,CURLOPT_TIMEOUT=>30,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2]);
    $content = curl_exec($handle);
    curl_close($handle);
    if (!is_string($content) || !hash_equals($expected,hash("sha256",$content))) throw new RuntimeException("Install checksum failed");
    if (file_put_contents($d."/".$name.".tmp",$content) === false) throw new RuntimeException("Install write failed");
    chmod($d."/".$name.".tmp",0600);
    if (!rename($d."/".$name.".tmp",$d."/".$name)) throw new RuntimeException("Install rename failed");
}
require $d."/sync.php";
