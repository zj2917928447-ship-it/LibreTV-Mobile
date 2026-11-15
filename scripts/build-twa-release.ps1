param(
  [Parameter(Mandatory=$true)]
  [string]$SiteUrl
)
$ErrorActionPreference='Stop'
$site=[Uri]$SiteUrl
if($site.Scheme -ne 'https'){throw 'Final TWA origin must use HTTPS.'}
if(-not $site.IsDefaultPort){throw 'Use the standard HTTPS port 443 for a TWA origin.'}
if($site.Host -match 'trycloudflare\.com|localhost|127\.0\.0\.1'){throw 'Temporary/local origins cannot be used for a release APK.'}
$origin=$site.GetLeftPart([UriPartial]::Authority)
$base='E:\Android'
$userHome=Join-Path $base 'BubblewrapHome'
$sdkRoot=Join-Path $base 'Sdk\cmdline-tools\latest'
$twa=Join-Path $base 'LibreTV-TWA'
$signing=Join-Path $base 'Signing'
$keystore=Join-Path $signing 'libretv-release.keystore'
$passwordFile=Join-Path $signing 'key-password.dpapi'
$packageName='com.zj2917928447.libretv'
$fingerprint='55:67:98:66:3C:B9:59:22:C5:C3:9F:72:13:41:6A:D4:18:3D:36:3C:C5:44:64:FE:7E:CB:84:03:D4:BC:40:AB'
if(-not (Test-Path $keystore) -or -not (Test-Path $passwordFile)){throw 'Release signing key or protected password file is missing.'}
$manifestUrl=$origin+'/manifest.webmanifest'
$assetlinksUrl=$origin+'/.well-known/assetlinks.json'
Write-Output '--- Verify deployed site'
$rootResponse=Invoke-WebRequest -Uri ($origin+'/') -UseBasicParsing -TimeoutSec 180
if($rootResponse.StatusCode -ne 200){throw "Site root returned HTTP $($rootResponse.StatusCode)"}
$manifestResponse=Invoke-WebRequest -Uri $manifestUrl -UseBasicParsing -TimeoutSec 180
if($manifestResponse.StatusCode -ne 200){throw "Web manifest returned HTTP $($manifestResponse.StatusCode)"}
$manifestText=if($manifestResponse.Content -is [byte[]]){[System.Text.Encoding]::UTF8.GetString($manifestResponse.Content)}else{[string]$manifestResponse.Content}
$webManifest=ConvertFrom-Json -InputObject $manifestText
if($webManifest.display -ne 'standalone'){throw "PWA display mode must be standalone; found '$($webManifest.display)'."}
if(-not $webManifest.start_url){throw 'PWA manifest is missing start_url.'}
$startUriCheck=[Uri]::new([Uri]$manifestUrl,[string]$webManifest.start_url)
if($startUriCheck.Host -ne $site.Host -or $startUriCheck.Scheme -ne 'https'){throw 'PWA start_url must remain on the final HTTPS origin.'}
$icon512=$webManifest.icons | Where-Object { $_.sizes -match '512' } | Select-Object -First 1
$icon192=$webManifest.icons | Where-Object { $_.sizes -match '192' } | Select-Object -First 1
if(-not $icon512 -or -not $icon192){throw 'PWA manifest must expose both 192px and 512px icons.'}
foreach($icon in @($icon192,$icon512)){
  $iconUrl=[Uri]::new([Uri]$manifestUrl,[string]$icon.src).AbsoluteUri
  $iconResponse=Invoke-WebRequest -Uri $iconUrl -Method Head -UseBasicParsing -TimeoutSec 45
  if($iconResponse.StatusCode -ne 200){throw "Icon failed: $iconUrl"}
}
Write-Output '--- Verify Digital Asset Links'
$assetResponse=Invoke-WebRequest -Uri $assetlinksUrl -UseBasicParsing -TimeoutSec 45
if($assetResponse.StatusCode -ne 200){throw "assetlinks.json returned HTTP $($assetResponse.StatusCode)"}
$assetlinksText=if($assetResponse.Content -is [byte[]]){[System.Text.Encoding]::UTF8.GetString($assetResponse.Content)}else{[string]$assetResponse.Content}
$assetlinks=ConvertFrom-Json -InputObject $assetlinksText
$assetTarget=$assetlinks | Where-Object { $_.target.package_name -eq $packageName } | Select-Object -First 1
if(-not $assetTarget){throw 'assetlinks.json does not contain the LibreTV Android package.'}
if($assetTarget.relation -notcontains 'delegate_permission/common.handle_all_urls'){throw 'assetlinks.json is missing the TWA handle_all_urls relation.'}
if($assetTarget.target.sha256_cert_fingerprints -notcontains $fingerprint){throw 'assetlinks.json certificate fingerprint does not match the release keystore.'}
Write-Output '--- Update TWA origin'
$twaManifestPath=Join-Path $twa 'twa-manifest.json'
$twaManifestText=[System.IO.File]::ReadAllText($twaManifestPath,[System.Text.Encoding]::UTF8)
$twaManifest=ConvertFrom-Json -InputObject $twaManifestText
$twaManifest.host=$site.Host
$startUri=[Uri]::new([Uri]$manifestUrl,[string]$webManifest.start_url)
$twaManifest.startUrl=$startUri.PathAndQuery
$twaManifest.iconUrl=[Uri]::new([Uri]$manifestUrl,[string]$icon512.src).AbsoluteUri
$twaManifest.webManifestUrl=$manifestUrl
$scope=[string]$webManifest.scope
if(-not $scope){$scope='.'}
$twaManifest.fullScopeUrl=[Uri]::new([Uri]$manifestUrl,$scope).AbsoluteUri
$twaManifest.name=[string]$webManifest.name
if($webManifest.short_name){$twaManifest.launcherName=[string]$webManifest.short_name}
$utf8=New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($twaManifestPath,($twaManifest | ConvertTo-Json -Depth 30),$utf8)
$env:USERPROFILE=$userHome
$env:HOME=$userHome
$env:JAVA_HOME=Join-Path $base 'JDK17'
$env:GRADLE_USER_HOME=Join-Path $base 'GradleHome'
$env:ANDROID_HOME=$sdkRoot
$env:ANDROID_SDK_ROOT=$sdkRoot
$env:ANDROID_USER_HOME=Join-Path $base 'AndroidUserHome'
Remove-Item Env:ANDROID_SDK_HOME -ErrorAction SilentlyContinue
$env:JAVA_TOOL_OPTIONS='-Dhttp.proxyHost=127.0.0.1 -Dhttp.proxyPort=7688 -Dhttps.proxyHost=127.0.0.1 -Dhttps.proxyPort=7688'
$env:PATH=(Join-Path $env:JAVA_HOME 'bin')+';'+(Join-Path $sdkRoot 'bin')+';'+(Join-Path $sdkRoot 'platform-tools')+';'+$env:PATH
Set-Location $twa
$ErrorActionPreference='Continue'
& 'E:\Android\BubblewrapCli\node_modules\.bin\bubblewrap.cmd' update --skipVersionUpgrade --manifest=twa-manifest.json
$updateExit=$LASTEXITCODE
$ErrorActionPreference='Stop'
if($updateExit -ne 0){throw 'Bubblewrap update failed.'}
$protected=(Get-Content $passwordFile -Raw).Trim() | ConvertTo-SecureString
$ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($protected)
try{$password=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)}finally{[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
$env:BUBBLEWRAP_KEYSTORE_PASSWORD=$password
$env:BUBBLEWRAP_KEY_PASSWORD=$password
$ErrorActionPreference='Continue'
& 'E:\Android\BubblewrapCli\node_modules\.bin\bubblewrap.cmd' build --manifest=twa-manifest.json
$buildExit=$LASTEXITCODE
$ErrorActionPreference='Stop'
Remove-Item Env:BUBBLEWRAP_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
Remove-Item Env:BUBBLEWRAP_KEY_PASSWORD -ErrorAction SilentlyContinue
if($buildExit -ne 0){throw 'Bubblewrap build failed.'}
$apk=Join-Path $twa 'app-release-signed.apk'
$aab=Join-Path $twa 'app-release-bundle.aab'
$buildTools=Join-Path $sdkRoot 'build-tools\36.1.0'
$ErrorActionPreference='Continue'
& (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apk
$sigExit=$LASTEXITCODE
& (Join-Path $buildTools 'zipalign.exe') -c -v 4 $apk
$alignExit=$LASTEXITCODE
$ErrorActionPreference='Stop'
if($sigExit -ne 0){throw 'APK signature verification failed.'}
if($alignExit -ne 0){throw 'APK alignment verification failed.'}
$sha=(Get-FileHash $apk -Algorithm SHA256).Hash
[pscustomobject]@{
  Site=$origin
  Package=$packageName
  APK=$apk
  APKBytes=(Get-Item $apk).Length
  APK_SHA256=$sha
  AAB=$aab
  AABBytes=(Get-Item $aab).Length
  AssetLinks='verified'
  Signature='verified'
  Alignment='verified'
}|ConvertTo-Json -Compress
