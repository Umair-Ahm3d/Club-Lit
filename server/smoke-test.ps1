Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Net.Http
Add-Type -AssemblyName System.Web.Extensions

$script:JsonSerializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$script:JsonSerializer.MaxJsonLength = [int]::MaxValue

function ConvertTo-PSObject {
    param($InputObject)
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
        $ordered = [ordered]@{}
        foreach ($key in $InputObject.Keys) {
            $ordered[$key] = ConvertTo-PSObject $InputObject[$key]
        }
        return [pscustomobject]$ordered
    }
    if ($InputObject -is [System.Collections.IEnumerable] -and -not ($InputObject -is [string])) {
        return @($InputObject | ForEach-Object { ConvertTo-PSObject $_ })
    }
    return $InputObject
}

function ConvertFrom-JsonDeep {
    param([string]$Json)
    if ([string]::IsNullOrWhiteSpace($Json)) { return $null }
    $raw = $script:JsonSerializer.DeserializeObject($Json)
    return ConvertTo-PSObject $raw
}

$script:ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$dotEnvPath = Join-Path $script:ScriptRoot ".env"
if ([string]::IsNullOrWhiteSpace($env:GROQ_API_KEY) -and (Test-Path $dotEnvPath)) {
    $groqLine = Get-Content -Path $dotEnvPath | Where-Object { $_ -match '^\s*GROQ_API_KEY\s*=' } | Select-Object -First 1
    if ($groqLine) {
        $parts = $groqLine.Split("=", 2)
        if ($parts.Count -eq 2) {
            $value = $parts[1].Trim()
            if ($value.StartsWith('"') -and $value.EndsWith('"')) {
                $value = $value.Substring(1, $value.Length - 2)
            } elseif ($value.StartsWith("'") -and $value.EndsWith("'")) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                $env:GROQ_API_KEY = $value
            }
        }
    }
}

function Get-OptionalProperty {
    param(
        [Parameter(Mandatory = $true)] $Object,
        [Parameter(Mandatory = $true)][string] $Name
    )
    if ($null -eq $Object) { return $null }
    $prop = $Object.PSObject.Properties[$Name]
    if ($prop) { return $prop.Value }
    return $null
}

$Failures = New-Object System.Collections.Generic.List[string]

function Write-Section {
    param([string]$Text)
    Write-Host "`n=== $Text ===" -ForegroundColor Cyan
}

function Pass {
    param([string]$Text)
    Write-Host "  [+] $Text" -ForegroundColor Green
}

function Fail {
    param([string]$Text, [string]$Details)
    Write-Host "  [-] $Text" -ForegroundColor Red
    if ($Details) { Write-Host "      $Details" }
    if ($Failures -notcontains $Text) { [void]$Failures.Add($Text) }
}

function Invoke-Step {
    param(
        [string]$Name,
        [ScriptBlock]$Script
    )
    try {
        $result = & $Script
        Pass $Name
        return $result
    } catch {
        $details = $_.Exception.Message
        $response = $_.Exception.Response
        if ($response -is [System.Net.Http.HttpResponseMessage] -and $response.Content -is [System.Net.Http.HttpContent]) {
            try {
                $bodyText = $response.Content.ReadAsStringAsync().Result
                if (-not [string]::IsNullOrWhiteSpace($bodyText)) {
                    $details = "$details`n$bodyText"
                }
            } catch {}
        }
        Fail $Name $details
        return $null
    }
}

function Invoke-Json {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers = @{},
        [object]$Body = $null
    )
    $params = @{
        Method      = $Method
        Uri         = $Uri
        Headers     = $Headers
        ContentType = 'application/json'
    }
    if ($Body -ne $null) {
        $params.Body = if ($Body -is [string]) { $Body } else { $Body | ConvertTo-Json -Depth 8 }
    }
    Invoke-RestMethod @params
}

function Invoke-MultipartForm {
    param(
        [string]$Method,
        [string]$Uri,
        [hashtable]$Headers = @{},
        [hashtable]$Form
    )

    $handler = New-Object System.Net.Http.HttpClientHandler
    $client = New-Object System.Net.Http.HttpClient($handler)
    try {
        foreach ($entry in $Headers.GetEnumerator()) {
            [void]$client.DefaultRequestHeaders.TryAddWithoutValidation($entry.Key, $entry.Value)
        }

        $content = New-Object System.Net.Http.MultipartFormDataContent
        foreach ($key in $Form.Keys) {
            $value = $Form[$key]
            if ($value -is [System.IO.FileInfo]) {
                $bytes = [IO.File]::ReadAllBytes($value.FullName)
                $byteContent = [System.Net.Http.ByteArrayContent]::new($bytes)
                $extension = $value.Extension.ToLowerInvariant()
                $mediaType = switch ($extension) {
                    ".png" { "image/png" }
                    ".jpg" { "image/jpeg" }
                    ".jpeg" { "image/jpeg" }
                    ".pdf" { "application/pdf" }
                    default { "application/octet-stream" }
                }
                $byteContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse($mediaType)
                $content.Add($byteContent, $key, $value.Name)
            } else {
                $stringValue = if ($value -is [string]) { $value } else { ($value | ConvertTo-Json -Depth 8) }
                $stringContent = New-Object System.Net.Http.StringContent($stringValue, [System.Text.Encoding]::UTF8)
                $content.Add($stringContent, $key)
            }
        }

        $request = New-Object System.Net.Http.HttpRequestMessage($Method.ToUpperInvariant(), $Uri)
        $request.Content = $content
        $response = $client.SendAsync($request).Result
        $body = $response.Content.ReadAsStringAsync().Result
        if (-not $response.IsSuccessStatusCode) {
            throw [System.Net.Http.HttpRequestException]::new($body)
        }
        if ([string]::IsNullOrWhiteSpace($body)) {
            return $null
        }
        return ConvertFrom-JsonDeep $body
    } finally {
        if ($content) { $content.Dispose() }
        $client.Dispose()
    }
}

function Ensure-Login {
    param([string]$Email, [string]$Password)
    Invoke-Json POST "$BaseUrl/api/auth/login" -Body @{ email = $Email; password = $Password }
}

function New-TempFileFromBase64 {
    param([string]$Base64, [string]$Extension)
    $path = Join-Path $env:TEMP ("smoke_" + [guid]::NewGuid().ToString("N") + $Extension)
    $clean = ($Base64 -replace '\s', '')
    [IO.File]::WriteAllBytes($path, [Convert]::FromBase64String($clean))
    return $path
}

function Extract-Filename {
    param([string]$RelativePath)
    if ([string]::IsNullOrWhiteSpace($RelativePath)) { return $null }
    return [IO.Path]::GetFileName($RelativePath)
}

# -------------------------------------------------------------------
# Configuration (fallback to defaults when env vars are missing)
# -------------------------------------------------------------------
$BaseUrl    = if ([string]::IsNullOrWhiteSpace($env:BASE_URL)) { 'http://localhost:8080' } else { $env:BASE_URL }
$AdminEmail = if ([string]::IsNullOrWhiteSpace($env:ADMIN_EMAIL)) { 'seedadmin@clubreaders.com' } else { $env:ADMIN_EMAIL }
$AdminPass  = if ([string]::IsNullOrWhiteSpace($env:ADMIN_PASS))  { 'ChangeMe123!' } else { $env:ADMIN_PASS }
$UserEmail  = if ([string]::IsNullOrWhiteSpace($env:USER_EMAIL))  { 'testuser_smoke@example.com' } else { $env:USER_EMAIL }
$UserPass   = if ([string]::IsNullOrWhiteSpace($env:USER_PASS))   { 'Password123!' } else { $env:USER_PASS }

# -------------------------------------------------------------------
# Temporary assets for uploads
# -------------------------------------------------------------------
$CoverBase64 = @"
iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5AELCyIlFyFOSAAAAB10RVh0U29mdHdhcmUAUGFpbnQuTkVUIHYzLjM2qefiJQAAAB1pVFh0Q3JlYXRpb24gVGltZQA1LzE4LzIwMjQtTSBi4gAAACB0RVh0TW9kaWZpZWQgRGF0ZQA1LzE4LzIwMjQgMDI6MDU6MzIrMDA6MDBxWJrqAAAAEklEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAA4DEAALY2f3gAAAAASUVORK5CYII=
"@

$PdfBase64 = @"
JVBERi0xLjQKJcOkw7zDtsOfCjIgMCBvYmoKPDwvTGVuZ3RoIDMgMCBSL0ZpbHRlci9GbGF0ZURlY29kZT4+CnN0cmVhbQp4nD2OywoCMQxF9/mKu3YRk7bp
tDAIDuh+oOAP+AAXgrOZ37etjmSTe3ISIljpDYGwwrKxRwrKGcsNlx1e31mt5UFTIYucMFiqcrlif1ZobP0do6g48eIPKE+ydk6aM0roJG/RegwcNhDr5tCh
d+z+miTJnWqoT/3oUabOToVmmvEBy5IoCgplbmRzdHJlYW0KZW5kb2JqCgozIDAgb2JqCjEzNAplbmRvYmoKCjUgMCBvYmoKPDwvTGVuZ3RoIDYgMCBSL0Zp
bHRlci9GbGF0ZURlY29kZS9MZW5ndGgxIDIzMTY0Pj4Kc3RyZWFtCnic7Xx5fFvVlf+59z0tdrzIu7xFz1G8Kl7i2HEWE8vxQlI3iRM71A6ksSwrsYptKZYU
E9omYStgloZhaSlMMbTsbSPLAZwEGgNlusxQ0mHa0k4Z8muhlJb8ynQoZVpi/b736nkjgWlnfn/8Pp9fpNx3zz33bPecc899T4oVHA55KIEOkUJO96DLvyQx
M5WI/omIpbr3BbU/3J61FPBpItOa3f49g1948t/vI4rLIzL8dM/A/t3vn77ZSpT0LlH8e/0eV98jn3k0mSj7bchY2Q/EpdNXm4hyIIOW9g8Gr+gyrq3EeAPG
VQM+t+uw5VrQ51yBcc6g6wr/DywvGAHegbE25Br0bFR/ezPGR4kq6/y+QPCnVBYl2ijka/5hjz95S8kmok8kEFl8wDG8xQtjZhRjrqgGo8kcF7+I/r98GY5T
nmwPU55aRIhb9PWZNu2Nvi7mRM9/C2flx5r+itA36KeshGk0wf5MWfQ+y2bLaSOp9CdkyxE6S3dSOnXSXSyVllImbaeNTAWNg25m90T3Rd+ii+jv6IHoU+zq
6GOY/yL9A70PC/5NZVRHm0G/nTz0lvIGdUe/Qma6nhbRWtrGMslFP8H7j7DhdrqDvs0+F30fWtPpasirp0ZqjD4b/YDK6Gb1sOGVuCfoNjrBjFF31EuLaQmN
ckf0J9HXqIi66Wv0DdjkYFPqBiqgy+k6+jLLVv4B0J30dZpmCXyn0mQ4CU0b6RIaohEapcfoByyVtRteMbwT/Wz0TTJSGpXAJi+9xWrZJv6gmhBdF/05XUrH
6HtYr3hPqZeqDxsunW6I/n30Ocqgp1g8e5o9a6g23Hr2quj90W8hI4toOTyyGXp66Rp6lr5P/05/4AejB2kDdUDzCyyfaawIHv8Jz+YH+AHlZarAanfC2hDd
R2FE5DidoGfgm3+l0/QGS2e57BOsl93G/sATeB9/SblHOar8i8rUR+FvOxXCR0F6kJ7Efn6RXmIGyK9i7ewzzMe+xP6eneZh/jb/k2pWr1H/op41FE2fnv5L
dHP0j2SlHPokXUkH4duv0QQdpR/Sj+kP9B/0HrOwVayf3c/C7DR7m8fxJXwL9/O7+IP8m8pm5TblWbVWXa9err6o/tzwBcNNJpdp+oOHpm+f/ub0j6JPRX+E
3EmC/CJqhUevQlY8SCfpZUj/Gb1KvxT5A/lr2Q72aWgJsBvYHeyb7AX2I/ZbrJLkewlfy5uh1ceH4aer+e38Dmh/Ce9T/Of8Vf47/kfFoCxRVip7lfuVsDKp
nFJ+rVrUIrVCXa5uUXeoUUSm2nCxocPwiOFxw3OGd4z1xj6j3/gb09Wma83/dLbs7L9N03T/dHh6ArlrRiZdCU98lR5A3h9FDH4Aj/4QFp+mdxGFHFbAimH3
atbK2tgm9il2GfOwq9n17O/Yl9k97AH2LawAa+Am2O7gjbyDu7iHX8uv57fwo3gf59/nP+Gv8DOwPEuxKw5lubJR2aFcqgxhDUHlgHItPHub8pjykvKy8qby
G+UMopalLlZD6pXq3erD6lH1R4ZPGgbxfsBw0jBl+JHhA8MHRm7MMeYZK42fMT5i/KXJaFppajfdaPoX03+Y/SyPlcFybX614NnYg4v5YzxdPcjOAJHPVErG
yh2IQwd2xX9QgzKNuCSJediWwbPVNMFpdKph8AfZCaplL9BBI1dQidXTFGG/4KfV5/lF9GPWw7LVh5Uhww94AT2OanSYP81PsPV0lNfzS/i9CrE32CP0BvL9
CrqDXc4C9Dg7w9awz7M6dpD+hWcqHexaqo8+wFUWxzaydwgW0FVqH33646sgW02/oLemv6omqp9DfZqkuxDRb9Br7FH6MzNE30Z1U1CNXKgyNyPfryNR9XZi
nx3EfsxGBRkwvkRHxYliqjOuU6+kd+g/6S3DcWTUelTSN6e96lfVX0XrouXYYdhl9Aj2XT9djB3zBrLkGYzF6DLs9HjUkmrs6nbaQX30eVS926Lh6L3Ra6L7
oz76R/D+mS1jf2Zj2BGT4Kin7+H9RfoZuwn78OL/3ikw3UdT9FtmZYWsGvvhjGGf4bDhMcNRw7cNLxqXw9vX0j3I6F8im+OxAjf9iH5Lf2JmxCabllEN7F0F
27togHcrz1ATyyE/9mwJ6vh6fSUBSLka3rsX+/kZ7I13UCcuo2/TK4yzLKzIDf1myGmDn3eB+iFE8Bo2AUwfqnYZ/Q7rTmKreBD6nJB0F6rWFGz6Bf0a3o5K
u5ahLjSzSyDrT/Qp6oOGldTOxhGBJ2k1Kmuz8k/w91JmofVsCfs6+HqwQ5Mon1YbfsU4LZveHF3FvcozOGOiwI/h9Mqli9heWJGMdZylDLaFaqe3wYaXiZyN
nc6GdRfVr12zelVdbc2K6uVVlRXlyxxlpSXFRYVL7UsKNNvi/LzcnGxrVmZGelpqiiU5KTFhUXyc2WQ0qApntKzF3tqjhYt6wmqRfcOGcjG2u4BwzUP0hDWg
WhfShLUeSaYtpHSCcveHKJ0xSucsJbNo9VRfvkxrsWvhF5vt2iTbsbUL8C3N9m4tfEbCmyR8WMKJgAsKwKC1WPubtTDr0VrCrfv6R1t6miFufFF8k73JE1++
jMbjFwFcBCicZfePs6x1TAI8q2XNOCdzIowK59ibW8LZ9mZhQVgpbHH1hdu3drU05xYUdJcvC7Mmt703TPb14WSHJKEmqSZsbAqbpBrNK1ZDN2njy6ZGb560
UG+PI6HP3ue6rCusuLqFjhQH9DaHs6583To3hPDUpq7r58/mKqMtVq8mhqOj12vhqa1d82cLxLW7GzLAywtbe0ZbofpmOLGtQ4M2fl13V5hdB5WaWIlYVWx9
HnuLwPR8RgvH2dfb+0c/04PQ5IyGadv+gkhOjvNY9DTltGijnV32gnBDrr3b1Zw3nk6j2/ZPZDu17IUz5cvGLSkxx44nJetAQuJ8wDM7JyFJLqC2bbOeZcIi
+0YkRFhza7Cky441rRIXzyoada8CGV7dDFzhPkTEG45r6hm1rBF4wR82FFrs2ugfCRlgP/P2QoxLxxgLLX8kAYo8mU01zM/AYYcjXFYmUsTUhJjCxnVyXFu+
bN8kX2n3WzR0cB+1w7eu7jWVcH9BgQjwTZNO6sUgfGhrV2ysUW9uhJyVju4w7xEzUzMzGdvFzKGZmVn2Hjsy+ah8EMgIm4tm/yVbMtNa+teEWebHTHti820d
9ratO7q0ltEe3bdtnQtGsflVs3M6FE5r6lJyuQ7xXEXOIikvmyUWg66EsFqIf0aZ1H1hBUkpEUxrDVt6NsSu3fEFBR/JM2kyz2OajL4juGQ3x6ZbGV7jWDhe
u2C8wLqEUQX2qkW8rXPH6Gj8grlWFKDR0Va71jraM+qajB7qtWsW++gx/jB/eNTf0jMT0Mno8Ztyw603d2MR/WwNkpXT+nE7u2HruJPd0LGj65gFT283dHZF
OONNPeu7x5dirusYbkWcEstnsWKkiRG1MSR6hJvlVO4xJ9EhOatKhBy7JxlJnHkGx8g9yWM4i8ThVY7bFBF8A9449U20/ihn00bTJG9wppFBnVYo3qROM8o2
Gw3TXHmaFVEcbnatZHVY3qs/W7/Z8m79prP11ADY8gEuy6sKUgpSCnFhuIH4QFOmPnAa6C+kqVPQhScYMrjwnGUhGx10rigxlMRfnOVRPQmGsqzVWRsyuzP7
Mw2rs1bmXp97t+GuRQZbSiEjnpZamGwxZxcfMTHTZHRqIm5RDUy82Zl2qIBpBVUFvCAlVSPNUmXhlkl+04S2vMPqgGk7hW2bLDv3vufYu+mMNLJB2kg797Kd
aQXVWZmZqRnpuBfE217AUlZU163jtTVFRcVF9jt4/lM9V032lNft3nRN79fPvsxKXv1c3YZd9fUDHeueMBzPK3pu+s0fPnHNmLutzKY+90FtUuolLzz22JO7
U5PEs/ct0d+oHbivy6R7nVmfStmTcpdBiTNmG+t5fUobb0t5k5uSJ3nQmaIuyqT4jPT0+DhjWnpRRgZNslJnUqZTW1pzJJNFM1lmjhWLdmYuWVpz2Dpm5X7r
O1b+eyuzxi8qijOLqWTQjpnZO2Zmzs5qqJdr3zvsEKvfjNUPO95D23Sm3iIjVW+BFxrOCC+wnQW1RqN9SVFRLaKWnpm5onrlSgEqm9c84738sU+ybNu2hg3D
ZSz7vu29n37sLj42bT3tWbsl9Dqb+svPxToP4H73y+o6KmZrj1EpjNmZEt9gMBoTMoyZCTVKjbnGWmNv5i3mFmuzPUFTKks74npKD5XeV/p148OmhxKeMD6R
EC49VXq6NIlKK0vbMXGy9LVSY6kzJ6+mAeNDctJgKlBNOfmZcFkk3lQgPLdYNVlSUopz8/KKiuMZGZMtRakpzh21PSnMl8JSJnmrMzkntyg/DzhfHuvJY3nA
HS1EdBl8HCEqFsmUHNcgeudK2F0M0mJnI1o92tLimmLnmotqKotfKn6tWEkuthUfKlaoWCuuKo4Wq8XZJb+K+Vq4OPZCtp2Bl9/budeBRHtv707RwefS6+Ld
cKbhDEtJXU1oy6vYsGPvToTBkVaQsXJFdWbWSnnNzEAIapCDS4xGCRbNgAeYctPU7ruqWh+4LPRASf70m/nFW9f2V0y/ubhhZWN/+fSbatFtj3Zu396567Lm
L5/t5ru+WlG/4aa7pjlvvWfHstZr7z77AWKWNL1V3YbcTGM1R1NLDCxtMnraaU1IrjFnJibXmMTFKC6GTOC4cI4tZ00NgqomLkoyWjilGdU0rioKg9vTeizM
MsmOOFMXJSdWJpWQllGV0ZOhvJPBMoR/lxTViN6Zmre4JiMrK0ddrTit2TUHFaZMsmJnHJcjVD8xSsXTiTNvZY1GVagW2enfGYs52LHpbDau+Gc9u7nF0/xr
h2Pv8CbLu69Tw5mdlQ3StSx1dYr0a+pqAKYki9joDibjsrMtbOloC69BxY+oFjoefYdY9J1xBc/veHXjRDlGhuhvnEmJKQ1plrRsXFKtDQacIRMYiD6CcUxW
d1pBWloBMyUp9iXFxWLL1CUxx/T7zD59Y1Nh06cOtm/dnL2+tvfT2WrR2ST+hw/4sZ29Fy1J+UVioFvUwDvxLPg+amAy7rdHnIVGw7H0Y1blYgPbY/iJgaem
FCYmJVGupRAuSSZz5jlVL9OWX5Xfk+/PP5RvyLckayzmLFH48hYWvtm6J6pe6urKudq3IqVAQ/HLSDeKymfP5nLj14i6dyf7V5a07cBjvV/a/JnvP/vAkX1N
n95QO2Y4nlnw6pHrJ70pGWd/qj433VPR29jenxiPbPoS1nMt1hNHw84Gs0E1GgpNmrnKfNL8mlmtNB82c7OZFFWsJ47MpgbjFjyKb1Nw8vAcbVHVIr5IjZu/
iPj5i0D9eg8ABnPL2LkXvWKw1GM1WEhGgWxfUs6cXcv7zt5rOP7+9IPvn71NVCcrHP5rw8uowpPO6pUqK1M1i5bSrR6yGszqSSvPyEzh6amZKUlpyWRJSmNk
4elx5uRFbNeiKAwTZSbeyFKSY4VYVh2c13jYFomPkr2iwbzF3G5WzCWWypRdKTxlkqnOxKS0Ip6+i8YypzJ5JkL3ZFxCTWZ21hXHuJfk0hx76zeJ0/KDnfXv
7sx+naxYm1gVWgMuq6uT8UJ5EMUhbUVtjSgLWSZRBDIyVmTYURLs1ntX3x26IlDUtO6i2n/+5+k371WL2r9wbcfS71hWb2179YOnlI0i126Hsd9AbMTZPnKM
4rAPG1DnnHHtcfxQXDhuKu5U3O/jDLa4nriDcWNAGBSjCQe/kkzMSafwxKjQTtwiGA1GkxrPTUVMFXs5rmBpjZpt1o8ah34LIAOEJcjQyOhgAcOONJjL0G5n
2dNvsmz1SaZOf/CXT6hFOEDYPAs7xBaccpYK+wztBn7IEDZMGU4Zfm8w2Aw9hoOGMSAMMAY3JVwpYjRjCWWr51ii614R02s4/udWeKMRZ3Ixzqp0ymNfO0aW
6PvO1kWr7477SuJdlkcMD8efiDuROJljNqezDfxiY2v8lsWPJD5pfDLnu/HfS/hJ/CsJ75v+lJiYl5yX4czNr8lwJqXUJGeczHgpQ5GFLnlxg+yTstDzW5wJ
yUmp7Uk9STzJmspEFmTn1rAVqcLsiXytRvZLSmO9ozzWW/Nk70xOSq4ZE/flFpi9KzUVmTehLkq1igxcushEBawyo2BLEkvKqVy8a7Fv8X2L1cXJBWYnirY5
O9/bGPPGpjNy+2w68y6KwBkUOWe61VmS3mB1Lk7GJdeCS15KgyxqDWdlEUyFEaBIFcaASPagE31khhTnnSyEkoEwgeNMzGeJLjwRF79ODhsLGhwk6F93oCjv
lOqTnPBSklCaJNQnOeEskkJRnBwOHKP1uAtD8HbupZ0OhiPHrhUX1VpoRTUpBfL+JE0chiZjFv8zs65868j0767zsvSXz7BU41mncrVr/Y5i5YpLLquvZ2xb
5Vfuf+K2V5kZ1fm70898/qYNbODKg01NAfkxmPiI79d7nvlx/8ldyfV/NGeb5adDD/yqfu5Tf5reavwyqgdDbWMzH58RmdZNb6amuQ/UPvQBU4IRKMN36Q71
V3SLKZ8OqAFK4qtx53sJ3Qncl/hjZMX4dtEw1wielfQ4s7H/5JN8UtGUIeV/qw1qyPBZXXoClSANxIsjISppO+65Nlt82AgCu0u9ksTduzRYXhXJFy9HiuTC
naEOK9TFLDqsUjrr12EDWdnndNgI+A4dNtF32Dd02ExF3K/DcTTK79LhePU5RdPhRdRr+qUOJ9Buc7MOJxqPmh/T4SS6LPnTs347mHxch+E2y2od5qRa1umw
Qsss63VYpXjLkA4bKMFyhQ4bAV+rwybqtRzWYTOlWf6gw3HUkmLQ4XjuSvmEDi+i5WmPz35btiLtFzqcqOxIT9bhJKrI8sISpgqvJ2V9SYdVysl6UMIG4OOz
TuqwSplZ35ewEXhj1ms6rFJq1hsSNom4ZP1JhxGLrKiEzcAnWNN0WCWr1SbhOBFfa50OI77ZtToMOdkNOoz4Zl+sw5CZfZ8OI77ZEzqM+Gb/ow4jvtm/0mHE
N+dhHUZ8c17UYcQ391M6jPhq2TqM+Gqf1WHEV/tfOoz4Ft8p4Xjhq+J/12H4qji2xkXAp5Zk67BKi0scEk4QaynZqMOwv2SrhJNE5pd4dFilvJKQhC1Szm06
LOR8TcJpwuclz+owfF7yXQmnC3tKfqbDsKfkTQlnAJ9eynRYJa00Q8KZgr60VodBX9ok4WxJv1OHBf1eCeeKHCi9TYeRA6X3SDhf2FM6rsOwp/QpCdsk/fd1
WNC/LOGlIgdK39Jh5EDpHyVcJvxTlqjD8E9ZzM5yUQnKSnVYnYHN0v+zMOwvk/ljlusq26rDAr9LwAkx+v06LPDXS1jGpex+HRZ6H6VO2k9+8tBucpEbvUaP
onVSv4Q3kY+G0II6lYaK6aNhwOLqAt4rKTRgBsBfAahZ4l3/Q0mVs5Zp1IGZAQrN0gSA24g+pm85rca7isp1qFpiG8ExgH4bePbAhqDk2gZ5AbRh2odrH6iG
Me8C5Xqpo+8cO9fMo9FmqdbQJVJKYNbqFdBahbeGKr8JWDdmfZj3wbNBKj2vlI+SMUdbPs+uznn4b0nPCr/1QcYg+mG6HDih7b/vcw1YD7zlhU1BaZvwkYax
oAnqUrcjHhq1S36NiqS+Tbhuge7d0vcu0As+D6QKb49ITiGt4jw2xeLsg15hkx+0+z+SyiPzS9CNSKv2zOr16tlbLqPso17d6s1ypl960QVrls3aPixnvDJT
O3ANSatjEYll1SrkUpO0JCi9POO3Ydiigcql52Iso7zS930yw0TODUld8+Pu1mW5pG2Cc1BKFHb3Q/+glBjzviatdkl9bj0asRlhdUCPh0uuMca3fzb+Xj3b
/XoEPdI3AZmNsdXNRMil2x+S2jSpYb5VM5EXvhHjESm7f142CFqflBXTPYOPeTuoe8StZ2rgHLogZHqkV7zoY7LdOiYkPS0yai6nfXLnDkuPDkh+YamI56DO
NaPBLfn36Vq9+kpj+1FImPPCblAKaTHsnF+9und9+kq8kj4kR3NRDcgsHZDWnT8nZmprYHYtYm5QypuTIerF5bq1Lt3/bln1NH2XzvisT+reI7ExfrHDvHoM
++W+8+s54sNV7Oh9urdjEuaqvUvGKpYdmvShW1+/V0ZtQNL45d6LZeOQ5IytZH52e2czS+z8K/TIDEprRG7u0/dWrO4MzNoxKEdz2Rv80IkU+ND63LqOXikh
JD3dtyA3PbQX+BnPitx2z65wt8xtTebAFdK3AZl3wdl6Eou6sD2234N61YjtpoCeZXPVMzY7KCPioislf8xqIdctZ+cyLaa9T3rLL3fJ/tlVzOgekjVTzLuk
J4Z1HWIPxbwYlPwzFs9I98scGpR1c8a2Cnn2BTG3BmdqJeSKd4Wkml9hK2R1GgRFv9xLA4AGAQ3JCHnkKEC7ZA7EIl4xS/l/V8OIzJgYrWeels2o9J0491vR
mpB5At4CrDgBWnH9pMS3ANOBq8jNi3EStOC9SWI7KRFPU6J1ymwKnCfXtFl8bJ/EPOrXfT6Xo3/dKTYXmZmKPBPnXjm7H/ShWZ3u2doWy+e582h+tYxVjrk6
Gtu/Xr1mBvQ9vUdK8czWRLFbu3VtYnfv02tp7+xpFNMZ/BjPzNTOkdnq5NF3nGc2p4dl/Qjq+3m3no/n89fMLhQe88yTMreLz9XXp5+AIgN7ZWWMWd2rR2ZI
l3y+CBXLVS30VKwin5sV52qeqW2iirnkvagLWgd0bwf0GvJRuoX3twMzV2f3nxMLj36XMf+eK1a9XdIiv/SsV7/T+Wtirum5ODSvts3oFZWkT3raO+8UGZ53
r7xslnp4Xt7Ond0f7ylh3aCUP5NXvgXyRmT8L5fRnH8fOlMf5yh9oI3doYakx4X8/tn1xOyan92DekWN+T+2q/x6fsxV3oU59HErmsuPjXLt50Zu5t5LnDke
/Q4ttprY/Z5bRnXoQzEY/pC/5yQH5N1qSN71x86hffLeaITm313919GfkTes3/959Wee893FnRvHmLfm7ljdUua5+3gmYq4P+Xr332TtnJfP1bDwvF9okUe/
iw3i7JmRIJ5PGin2JFCCe/gaqsPzl4brcozK8XxVI5+yxKcj26lNp6zC7HLM1OhwHZ7G6iTXSqrFs4BoQvrfdtb990/GmbnKD3lv9jzs3O/37Ha5PdqjWme/
R9vkG/IFgdKafMN+37Ar6PUNaf4Bd4XW7Aq6/guiSiFM6/ANhAQmoG0cAt/y1aurynGprtAaBwa0bd49/cGAts0T8Azv8/Q1DntdA+t9A30zMtdIjCZQay7x
DAeE6BUVVVVaySave9gX8O0Ols6RzKeQ2HIpq1PCj2idw64+z6Br+HLNt/tjLdeGPXu8gaBn2NOneYe0IEi3d2jtrqBWpHVu0rbs3l2huYb6NM9AwDPSD7KK
WUlYs2/PsMvfv38+yqM1D7tGvEN7BK8X7i3Xtvl6IXqz193vG3AFlgnpw16316V1uEJDfVgIXLWqusk3FPQMCtuG92sBF7wIR3l3a32egHfP0DIttnY3qFxe
TA76hj1af2jQNQTzNXe/a9jlxjIw8LoDWIdrSMPcfrF+L9zuxwI9bk8g4IM6sSAX5Ifc/ZpXFyUWHxryaCPeYL90w6DP1ye4BQyzgzDEDacGZnDBEc9Q0OsB
tRtAaHh/hSY97dvnGXYh3sFhjys4iCnB4A4h5gGhTMTRMyxN2B0aGAAobYX6QR+UeIf6QoGgXGoguH/AM98TIlsDQotneNA7JCmGfZdDrAv2u0NQFAtgn9e1
xyfmR/rhc63fM+CHR3zaHu8+jySQae/SBuAObdAD3w153SB3+f0euHHI7YGSmLu9wlma5wosZtAzsF/D2gLInQEhY9A7IN0b1DdSQNfnBkevRwsFkFLSm569
IWFsyC38r+32YcmQiEUFgyJPsPRhD+IeRGogTAG4TKYnhoOuPa4rvUMQ7Qm6l8WcBvY+b8A/4NovVAjuIc9IwO/ywzSQ9MHEoDcgBAty/7Bv0CelVfQHg/41
lZUjIyMVg3rCVrh9g5X9wcGBysGg+NuSysHALpdYeIVA/pUMI54BYD2SZfOWzo2tG5saOzdu2axtadU+ubGpZXNHi9Z48baWlk0tmzsT4xPjO/vh1hmvCReL
mMBQrCAoPXqeLSYXIxJZrLl3v7bfFxKcbpFt8LPcR7G0RHLIHEV8sf2GQO7aM+zxiEys0LrB1u9CGvh6xTYCZ3CBMSI7R0Q6eRA4j/D0sMcdRJx3w49zdokQ
+vZ4JIkM8SwfQoPs7Q0FIRpm+rCj5i2oODBjFBJ51hWzzCLbtH2ugZCrFxnmCiBD5nNXaNuHZM7un1kF1qRXLqS3Swv4PW4vis65K9fgxSGZbYLX1dfnFTmB
rByWVXmZQA9L38rd/SGjBryDXrEgKJF0I77hywOxJJX5KJG+ERTUUO+AN9Av9EBWzN2DSFTYj1D592ux5NU9tFCR9MfG3XOLE9Vrb8gTkGpQ99ye4SF9BcO6
3ZI40O8LDfRhD+3zekZi5eqc5Qs6RNKDCtA3V+Jm1wizZGF1B+diLBbm0q3efX6x0uRZBn3f64KgxxVcIwi2dzTiEChZVVNXqtUtX1VeVVNVFRe3vQ3IquXL
a2pwrVtRp9WtrF1duzox/iN23cduRjGq1M2T+xCPqx79Jknc6sz/mGXhTJBCLBG3Bm8toJnD7qaFH3NrOqZV/9Bj/oyOU25QnlG+o5zEdXz+/AL8ha8NLnxt
cOFrgwtfG1z42uDC1wYXvja48LXBha8NLnxtcOFrgwtfG1z42uDC1wYXvjb4f/hrg9nPD7z0UZ8sxGY+iT6WrT6JCS2gPXf2Ylk1AguoZnCt9BbGl9N7oH8L
uIWfOiycm+GZub/ynVfi3OwlEppPE8NskKN98vOOhfMLZ9r10zckn/18clfOpz7f/HxP+T7Shz7Vpq5T16pN6kp1lepUL1Lb1NXzqc8733neT3TmsK3nrCeG
aRMjthw08+fmsG36venlH7J4Hp6l0C8VO7Jk3vws7q/Nm7/SN3+1vI/LK/3/y1O0mH5K53l9mzqVr1AyY2SLTilfnrCkVzsnlbsnktOqnY0W5U5qR+MUVjbR
FBonn3IbHUTjIG+LlC+vPiaAifikagvobyIN7RCaQmO4Mjl2ogn6mybSMoX4ayLJKZLvs5GqmhgwYbFWtzemK1cQUzzKENnJphxAvxi9G30++l6lD5VC2Omc
SLZUH4K+BpA3KBkoQzalUcmkavTNSg7lSrJQJCmmJxQpKatujFeaFKskSVYSUY9silkxRapt2glF/NmwU7lhIm6RsO+GiCWj+hnlOsVE6aA6BKosW/IzSjxV
oomVdE7EJVYfbkxQOrHMTrjFpoj/rH+fvDqVoQgEQV+LkkeZmLtcyacM9K3K4kiGbeqEcrsk+zshBfrWRcwrRDeRmFQ91RiniL8HCCu3wuO3Sm2HJ4pWVVNj
kVJCVYr4EwlNOQjooPjP4soooFGEaRShGUVoRmHFKBkR+RsxcyNoKpUrya+M0GG0+wCrEJkRgQePSWBpSfUxJVuxwhOWE/AdAzZnIi5JWGaNpKZJMutEQlJ1
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
wRfFI4d7cgu612da/OtEQh9bW2A9kHtcJfYILXJ0hxPs68OJaGKqvLG8UUxhn4mpJPHzbvqU9cDagtzj7BF9ygJ0in09zbiWBFFbuHZrW7igY0eXSJWw03X+
mAXES05bqcXbjH8YB2XDez4lBc77Cp7vFQqFAuIScuApuS1c1tEWXrkVlphMUNXT3A1cxQxOUSRuPC6uZTI6hUkHjGBBoU5ADiZ+I8AZj6cuEx8zjpm4eFQI
TuTkV/uewQl+EA3PcXwkUimfl/nIxJJC8fwSnKisjfV4PhV9JKegWvwUQR1YRV8Y650p5QAOFx4uP1w3VjhWPlZnFD+08BCQtofEURqpfEihoCMw4wiAwW6K
/XQB9N0fycuXiscE4HB0OwLyN17ow6526L8jA6fPOjagSw1I8cGZgMTwAYoRxyYdoRmmkM4iJ0OSRSr8P1jbNhMKZW5kc3RyZWFtCmVuZG9iagoKNiAwIG9i
agoxMDgyNQplbmRvYmoKCjcgMCBvYmoKPDwvVHlwZS9Gb250RGVzY3JpcHRvci9Gb250TmFtZS9CQUFBQUErQXJpYWwtQm9sZE1UCi9GbGFncyA0Ci9Gb250
QkJveFstNjI3IC0zNzYgMjAwMCAxMDExXS9JdGFsaWNBbmdsZSAwCi9Bc2NlbnQgOTA1Ci9EZXNjZW50IDIxMQovQ2FwSGVpZ2h0IDEwMTAKL1N0ZW1WIDgw
Ci9Gb250RmlsZTIgNSAwIFI+PgplbmRvYmoKCjggMCBvYmoKPDwvTGVuZ3RoIDI3Mi9GaWx0ZXIvRmxhdGVEZWNvZGU+PgpzdHJlYW0KeJxdkc9uhCAQxu88
BcftYQNadbuJMdm62cRD/6S2D6AwWpKKBPHg2xcG2yY9QH7DzDf5ZmB1c220cuzVzqIFRwelpYVlXq0A2sOoNElSKpVwe4S3mDpDmNe22+JgavQwlyVhbz63
OLvRw0XOPdwR9mIlWKVHevioWx+3qzFfMIF2lJOqohIG3+epM8/dBAxVx0b6tHLb0Uv+Ct43AzTFOIlWxCxhMZ0A2+kRSMl5RcvbrSKg5b9cskv6QXx21pcm
vpTzLKs8p8inPPA9cnENnMX3c+AcOeWBC+Qc+RT7FIEfohb5HBm1l8h14MfIOZrc3QS7YZ8/a6BitdavAJeOs4eplYbffzGzCSo83zuVhO0KZW5kc3RyZWFt
CmVuZG9iagoKOSAwIG9iago8PC9UeXBlL0ZvbnQvU3VidHlwZS9UcnVlVHlwZS9CYXNlRm9udC9CQUFBQUErQXJpYWwtQm9sZE1UCi9GaXJzdENoYXIgMAov
TGFzdENoYXIgMTEKL1dpZHRoc1s3NTAgNzIyIDYxMCA4ODkgNTU2IDI3NyA2NjYgNjEwIDMzMyAyNzcgMjc3IDU1NiBdCi9Gb250RGVzY3JpcHRvciA3IDAg
UgovVG9Vbmljb2RlIDggMCBSCj4+CmVuZG9iagoKMTAgMCBvYmoKPDwKL0YxIDkgMCBSCj4+CmVuZG9iagoKMTEgMCBvYmoKPDwvRm9udCAxMCAwIFIKL1By
b2NTZXRbL1BERi9UZXh0XT4+CmVuZG9iagoKMSAwIG9iago8PC9UeXBlL1BhZ2UvUGFyZW50IDQgMCBSL1Jlc291cmNlcyAxMSAwIFIvTWVkaWFCb3hbMCAw
IDU5NSA4NDJdL0dyb3VwPDwvUy9UcmFuc3BhcmVuY3kvQ1MvRGV2aWNlUkdCL0kgdHJ1ZT4+L0NvbnRlbnRzIDIgMCBSPj4KZW5kb2JqCgoxMiAwIG9iago8
PC9Db3VudCAxL0ZpcnN0IDEzIDAgUi9MYXN0IDEzIDAgUgo+PgplbmRvYmoKCjEzIDAgb2JqCjw8L1RpdGxlPEZFRkYwMDQ0MDA3NTAwNkQwMDZEMDA3OTAw
MjAwMDUwMDA0NDAwNDYwMDIwMDA2NjAwNjkwMDZDMDA2NT4KL0Rlc3RbMSAwIFIvWFlaIDU2LjcgNzczLjMgMF0vUGFyZW50IDEyIDAgUj4+CmVuZG9iagoK
NCAwIG9iago8PC9UeXBlL1BhZ2VzCi9SZXNvdXJjZXMgMTEgMCBSCi9NZWRpYUJveFsgMCAwIDU5NSA4NDIgXQovS2lkc1sgMSAwIFIgXQovQ291bnQgMT4+
CmVuZG9iagoKMTQgMCBvYmoKPDwvVHlwZS9DYXRhbG9nL1BhZ2VzIDQgMCBSCi9PdXRsaW5lcyAxMiAwIFIKPj4KZW5kb2JqCgoxNSAwIG9iago8PC9BdXRo
b3I8RkVGRjAwNDUwMDc2MDA2MTAwNkUwMDY3MDA2NTAwNkMwMDZGMDA3MzAwMjAwMDU2MDA2QzAwNjEwMDYzMDA2ODAwNkYwMDY3MDA2OTAwNjEwMDZFMDA2
RTAwNjkwMDczPgovQ3JlYXRvcjxGRUZGMDA1NzAwNzIwMDY5MDA3NDAwNjUwMDcyPgovUHJvZHVjZXI8RkVGRjAwNEYwMDcwMDA2NTAwNkUwMDRGMDA2NjAw
NjYwMDY5MDA2MzAwNjUwMDJFMDA2RjAwNzIwMDY3MDAyMDAwMzIwMDJFMDAzMT4KL0NyZWF0aW9uRGF0ZShEOjIwMDcwMjIzMTc1NjM3KzAyJzAwJyk+Pgpl
bmRvYmoKCnhyZWYKMCAxNgowMDAwMDAwMDAwIDY1NTM1IGYgCjAwMDAwMTE5OTcgMDAwMDAgbiAKMDAwMDAwMDAxOSAwMDAwMCBuIAowMDAwMDAwMjI0IDAw
MDAwIG4gCjAwMDAwMTIzMzAgMDAwMDAgbiAKMDAwMDAwMDI0NCAwMDAwMCBuIAowMDAwMDExMTU0IDAwMDAwIG4gCjAwMDAwMTExNzYgMDAwMDAgbiAKMDAw
MDAxMTM2OCAwMDAwMCBuIAowMDAwMDExNzA5IDAwMDAwIG4gCjAwMDAwMTE5MTAgMDAwMDAgbiAKMDAwMDAxMTk0MyAwMDAwMCBuIAowMDAwMDEyMTQwIDAw
MDAwIG4gCjAwMDAwMTIxOTYgMDAwMDAgbiAKMDAwMDAxMjQyOSAwMDAwMCBuIAowMDAwMDEyNDk0IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSAxNi9Sb290
IDE0IDAgUgovSW5mbyAxNSAwIFIKL0lEIFsgPEY3RDc3QjNEMjJCOUY5MjgyOUQ0OUZGNUQ3OEI4RjI4Pgo8RjdENzdCM0QyMkI5RjkyODI5RDQ5RkY1RDc4
QjhGMjg+IF0KPj4Kc3RhcnR4cmVmCjEyNzg3CiUlRU9GCg==

"@

$TempCover  = New-TempFileFromBase64 $CoverBase64 ".png"
$TempPdf    = New-TempFileFromBase64 $PdfBase64 ".pdf"
$TempAvatar = New-TempFileFromBase64 $CoverBase64 ".png"
$TempDownloads = @()

# -------------------------------------------------------------------
# Resource tracking for cleanup
# -------------------------------------------------------------------
$CreatedBookIds  = New-Object System.Collections.Generic.List[string]
$CreatedClubIds  = New-Object System.Collections.Generic.List[string]
$CreatedUserIds  = New-Object System.Collections.Generic.List[string]
$CreatedMessages = New-Object System.Collections.Generic.List[string]

$UserToken = $null
$UserId    = $null
$AdminToken = $null
$AdminUserId = $null
$ApiUserId = $null
$ApiUserEmail = $null
$ApiUserPassword = $null
$AdminBookId = $null
$AdminBook2Id = $null
$AdminBookTitle = $null
$ExistingClubId = $null
$AdminClubId = $null
$AdminClub2Id = $null
$AdminMessageId = $null
$BookRequestId = $null
$NotificationIds = @()

try {
    Write-Section "1. Auth & User setup"

    try {
        Invoke-Json POST "$BaseUrl/api/auth/register" -Body @{
            UserName = "smoke_$([guid]::NewGuid().ToString('N').Substring(0,6))"
            email    = $UserEmail
            password = $UserPass
        } | Out-Null
        Pass "POST /api/auth/register"
    } catch {
        $status = try { $_.Exception.Response.StatusCode.Value__ } catch { $null }
        if ($status -eq 409) {
            Pass "POST /api/auth/register (already exists)"
        } else {
            Fail "POST /api/auth/register" $_.Exception.Message
        }
    }

    $loginResp = Invoke-Step "POST /api/auth/login (user)" { Ensure-Login $UserEmail $UserPass }
    if ($loginResp) {
        $UserToken = $loginResp.token
        $UserId    = $loginResp.user.id
    }

    if ($UserToken) {
        Invoke-Step "POST /api/auth/logout" {
            Invoke-RestMethod -Method Post -Uri "$BaseUrl/api/auth/logout" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        $loginResp = Invoke-Step "POST /api/auth/login (user, re-login)" { Ensure-Login $UserEmail $UserPass }
        if ($loginResp) {
            $UserToken = $loginResp.token
            $UserId    = $loginResp.user.id
        }
    } else {
        Fail "POST /api/auth/logout" "User token unavailable"
    }

    if ($UserToken) {
        Invoke-Step "GET /api/auth/me" {
            Invoke-RestMethod "$BaseUrl/api/auth/me" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/profile/profile" {
            Invoke-RestMethod "$BaseUrl/api/profile/profile" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null
    }

    Write-Section "2. Secondary user & password reset"

    $apiGuid = [guid]::NewGuid().ToString('N').Substring(0,6)
    $ApiUserEmail = "api_$apiGuid@example.com"
    $ApiUserPassword = "ApiPass123!"
    $createResp = Invoke-Step "POST /api/users" {
        Invoke-Json POST "$BaseUrl/api/users" -Body @{
            UserName = "apiuser_$apiGuid"
            email    = $ApiUserEmail
            password = $ApiUserPassword
        }
    }
    if ($createResp) {
        $CreatedUserIds.Add($createResp.user.id) | Out-Null
    }

    $apiLogin = if ($createResp) {
        Invoke-Step "POST /api/auth/login (api user)" { Ensure-Login $ApiUserEmail $ApiUserPassword }
    } else { $null }

    if ($apiLogin) {
        $ApiUserId = $apiLogin.user.id
        $NewPassword = "ApiPass456!"
        Invoke-Step "POST /api/auth/reset-password" {
            Invoke-Json POST "$BaseUrl/api/auth/reset-password" -Body @{
                email = $ApiUserEmail
                newPassword = $NewPassword
                confirmPassword = $NewPassword
            }
        } | Out-Null
        $apiLogin = Invoke-Step "POST /api/auth/login (api user after reset)" { Ensure-Login $ApiUserEmail $NewPassword }
        if ($apiLogin) {
            $ApiUserPassword = $NewPassword
        }
    }

    Write-Section "3. Admin login"
    $adminLogin = Invoke-Step "POST /api/auth/login (admin)" { Ensure-Login $AdminEmail $AdminPass }
    if ($adminLogin) {
        $AdminToken = $adminLogin.token
        $AdminUserId = $adminLogin.user.id
    }

    Write-Section "4. Books - admin uploads"
    if ($AdminToken) {
        $adminBookResp = Invoke-Step "POST /api/books/books" {
            Invoke-MultipartForm -Method 'POST' -Uri "$BaseUrl/api/books/books" -Headers @{ Authorization = "Bearer $AdminToken" } -Form @{
                title       = "Smoke Library Book"
                author      = "Smoke Admin"
                description = "Uploaded via smoke test"
                genres      = '["smoke","test"]'
                coverImage  = Get-Item $TempCover
                bookPdf     = Get-Item $TempPdf
            }
        }
        if ($adminBookResp) {
            $AdminBookId = $adminBookResp.book._id
            $AdminBookTitle = $adminBookResp.book.title
            $CreatedBookIds.Add($AdminBookId) | Out-Null
        }

        $adminBook2Resp = Invoke-Step "POST /api/admin/books" {
            Invoke-MultipartForm -Method 'POST' -Uri "$BaseUrl/api/admin/books" -Headers @{ Authorization = "Bearer $AdminToken" } -Form @{
                title       = "Smoke Admin Book"
                author      = "Smoke Tester"
                description = "Admin upload from smoke script"
                genres      = '["testing","automation"]'
                coverImage  = Get-Item $TempCover
                bookPdf     = Get-Item $TempPdf
            }
        }
        if ($adminBook2Resp) {
            $AdminBook2Id = $adminBook2Resp.book.id
            $CreatedBookIds.Add($AdminBook2Id) | Out-Null
        }
    }

    Write-Section "5. Books - user interactions"
    if ($UserToken -and $AdminBookId) {
        $books = Invoke-Step "GET /api/books" {
            Invoke-RestMethod "$BaseUrl/api/books" -Headers @{ Authorization = "Bearer $UserToken" }
        }
        $BookId = if ($books) { $books[0]._id } else { $AdminBookId }
        if (-not $BookId) { $BookId = $AdminBookId }

        Invoke-Step "POST /api/auth/book-history" {
            Invoke-Json POST "$BaseUrl/api/auth/book-history" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ bookId = $BookId }
        } | Out-Null

        Invoke-Step "GET /api/books/$BookId" {
            Invoke-RestMethod "$BaseUrl/api/books/$BookId" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "POST /api/books/:id/rate" {
            Invoke-Json POST "$BaseUrl/api/books/$BookId/rate" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ rating = 4.5 }
        } | Out-Null

        $comment = Invoke-Step "POST /api/books/:id/comments" {
            Invoke-Json POST "$BaseUrl/api/books/$BookId/comments" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ text = "Smoke test comment" }
        }
        Invoke-Step "GET /api/books/:id/comments" {
            Invoke-RestMethod "$BaseUrl/api/books/$BookId/comments" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "POST /api/books/:id/bookmarks" {
            Invoke-Json POST "$BaseUrl/api/books/$BookId/bookmarks" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ page = 12 }
        } | Out-Null

        Invoke-Step "GET /api/books/:id/bookmarks" {
            Invoke-RestMethod "$BaseUrl/api/books/$BookId/bookmarks" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "POST /api/books/:id/highlights" {
            Invoke-Json POST "$BaseUrl/api/books/$BookId/highlights" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ text = "Highlight"; page = 5; coordinates = @{ x = 10; y = 25 } }
        } | Out-Null

        Invoke-Step "GET /api/books/:id/highlights" {
            Invoke-RestMethod "$BaseUrl/api/books/$BookId/highlights" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/books/genres" {
            Invoke-RestMethod "$BaseUrl/api/books/genres" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/books/rankings/reads" {
            Invoke-RestMethod "$BaseUrl/api/books/rankings/reads" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/books/rankings/most-visited" {
            Invoke-RestMethod "$BaseUrl/api/books/rankings/most-visited" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/books/rankings/highest-rated" {
            Invoke-RestMethod "$BaseUrl/api/books/rankings/highest-rated" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/books/rankings/most-discussed" {
            Invoke-RestMethod "$BaseUrl/api/books/rankings/most-discussed" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "GET /api/books/:id/toc" {
            Invoke-RestMethod "$BaseUrl/api/books/$BookId/toc" -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "PUT /api/books/:id/toc" {
            Invoke-Json PUT "$BaseUrl/api/books/$BookId/toc" -Headers @{ Authorization = "Bearer $AdminToken" } `
                -Body @{ toc = @(@{ title = "Chapter 1"; page = 1 }, @{ title = "Chapter 2"; page = 10 }) }
        } | Out-Null

        $bookDetail = Invoke-Step "GET /api/books/:id (after toc)" {
            Invoke-RestMethod "$BaseUrl/api/books/$BookId" -Headers @{ Authorization = "Bearer $UserToken" }
        }

        $pdfFilename = Extract-Filename($bookDetail.pdfUrl)
        $coverFilename = Extract-Filename($bookDetail.coverImage)

        if ($pdfFilename) {
            $TempDownloads += (Invoke-Step "GET /api/books/pdf/:filename" {
                $outPath = Join-Path $env:TEMP ("smoke_dl_" + $pdfFilename)
                Invoke-RestMethod "$BaseUrl/api/books/pdf/$pdfFilename" -Headers @{ Authorization = "Bearer $UserToken" } -OutFile $outPath
                return $outPath
            })
        }

        if ($coverFilename) {
            $TempDownloads += (Invoke-Step "GET /api/books/image/:filename" {
                $outPath = Join-Path $env:TEMP ("smoke_img_" + $coverFilename)
                Invoke-RestMethod "$BaseUrl/api/books/image/$coverFilename" -OutFile $outPath
                return $outPath
            })
        }

        if ($pdfFilename) {
            $TempDownloads += (Invoke-Step "GET /api/books/:filename" {
                $outPath = Join-Path $env:TEMP ("smoke_pdf_" + $pdfFilename)
                Invoke-RestMethod "$BaseUrl/api/books/$pdfFilename" -OutFile $outPath
                return $outPath
            })
        }

        Invoke-Step "GET /api/books/:bookId/pdf" {
            $outPath = Join-Path $env:TEMP ("smoke_full_$pdfFilename")
            Invoke-RestMethod "$BaseUrl/api/books/$BookId/pdf" -Headers @{ Authorization = "Bearer $UserToken" } -OutFile $outPath
            $outPath
        } | Out-Null
    }

    Write-Section "6. User profile extras"
    if ($UserToken) {
        Invoke-Step "POST /api/users/toggle-favorite" {
            Invoke-Json POST "$BaseUrl/api/users/toggle-favorite" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ bookId = $AdminBookId }
        } | Out-Null

        Invoke-Step "POST /api/users/favorites (remove)" {
            Invoke-Json POST "$BaseUrl/api/users/favorites" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ bookId = $AdminBookId; action = "remove" }
        } | Out-Null

        Invoke-Step "POST /api/users/profile/avatar" {
            Invoke-MultipartForm -Method 'POST' -Uri "$BaseUrl/api/users/profile/avatar" `
                -Headers @{ Authorization = "Bearer $UserToken" } `
                -Form @{ avatar = Get-Item $TempAvatar }
        } | Out-Null
    }

    Write-Section "7. Clubs & messages"
    if ($UserToken) {
        $clubsList = Invoke-Step "GET /api/clubs" {
            Invoke-RestMethod "$BaseUrl/api/clubs" -Headers @{ Authorization = "Bearer $UserToken" }
        }
        if ($clubsList -is [System.Array] -and $clubsList.Length -gt 0) {
            $ExistingClubId = $clubsList[0]._id
        }
    }

    if ($AdminToken) {
        $clubBookTitle = if ([string]::IsNullOrWhiteSpace($AdminBookTitle)) { "Smoke Library Book" } else { $AdminBookTitle }

        $adminClub = Invoke-Step "POST /api/clubs (admin)" {
            Invoke-Json POST "$BaseUrl/api/clubs" -Headers @{ Authorization = "Bearer $AdminToken" } `
                -Body @{
                    name = "Smoke Admin Club"
                    book = $clubBookTitle
                    description = "Created via smoke test"
                    active = $true
                }
        }
        if ($adminClub) {
            $AdminClubId = $adminClub._id
            $CreatedClubIds.Add($AdminClubId) | Out-Null
        }

        $adminClub2 = Invoke-Step "POST /api/clubs (admin second)" {
            Invoke-Json POST "$BaseUrl/api/clubs" -Headers @{ Authorization = "Bearer $AdminToken" } `
                -Body @{
                    name = "Smoke Removal Club"
                    book = $clubBookTitle
                    description = "Second club for removal tests"
                    active = $true
                }
        }
        if ($adminClub2) {
            $AdminClub2Id = $adminClub2._id
            $CreatedClubIds.Add($AdminClub2Id) | Out-Null
        }
    }

    if ($UserToken -and $AdminClubId) {
        Invoke-Step "POST /api/clubs/joinClub (admin club)" {
            Invoke-Json POST "$BaseUrl/api/clubs/joinClub" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ clubId = $AdminClubId }
        } | Out-Null

        if ($ExistingClubId) {
            $message = Invoke-Step "POST /api/messages" {
                Invoke-Json POST "$BaseUrl/api/messages" -Headers @{ Authorization = "Bearer $UserToken" } `
                    -Body @{ clubId = $ExistingClubId; message = "Smoke test message" }
            }
            if ($message) {
                $MessageId = $message._id
                Invoke-Step "GET /api/messages/:clubId" {
                    Invoke-RestMethod "$BaseUrl/api/messages/$ExistingClubId" -Headers @{ Authorization = "Bearer $UserToken" }
                } | Out-Null
                Invoke-Step "PUT /api/messages/:id" {
                    Invoke-Json PUT "$BaseUrl/api/messages/$MessageId" -Headers @{ Authorization = "Bearer $UserToken" } `
                        -Body @{ message = "Updated smoke message" }
                } | Out-Null
                Invoke-Step "DELETE /api/messages/:id" {
                    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/messages/$MessageId" -Headers @{ Authorization = "Bearer $UserToken" }
                } | Out-Null
            }
        }

        if ($AdminToken) {
            Invoke-Step "DELETE /api/messages/removeMember" {
                Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/messages/removeMember/$AdminClubId/$UserId" `
                    -Headers @{ Authorization = "Bearer $AdminToken" }
            } | Out-Null

            Invoke-Step "POST /api/clubs/joinClub (admin club rejoin)" {
                Invoke-Json POST "$BaseUrl/api/clubs/joinClub" -Headers @{ Authorization = "Bearer $UserToken" } `
                    -Body @{ clubId = $AdminClubId }
            } | Out-Null

            Invoke-Step "POST /api/clubs/joinClub (admin club2)" {
                Invoke-Json POST "$BaseUrl/api/clubs/joinClub" -Headers @{ Authorization = "Bearer $UserToken" } `
                    -Body @{ clubId = $AdminClub2Id }
            } | Out-Null

            Invoke-Step "DELETE /api/clubs/:clubId/removeMember/:userId" {
                Invoke-RestMethod -Method Delete `
                    -Uri "$BaseUrl/api/clubs/$AdminClub2Id/removeMember/$UserId" `
                    -Headers @{ Authorization = "Bearer $AdminToken" }
            } | Out-Null

            Invoke-Step "POST /api/clubs/joinClub (admin club2 rejoin)" {
                Invoke-Json POST "$BaseUrl/api/clubs/joinClub" -Headers @{ Authorization = "Bearer $UserToken" } `
                    -Body @{ clubId = $AdminClub2Id }
            } | Out-Null
        }

        Invoke-Step "POST /api/clubs/leaveClub" {
            $clubForLeave = if ([string]::IsNullOrWhiteSpace($AdminClub2Id)) { $AdminClubId } else { $AdminClub2Id }
            Invoke-Json POST "$BaseUrl/api/clubs/leaveClub" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ clubId = $clubForLeave }
        } | Out-Null
    }

    if ($AdminToken) {
        Invoke-Step "GET /api/clubs/admin/all" {
            Invoke-RestMethod "$BaseUrl/api/clubs/admin/all" -Headers @{ Authorization = "Bearer $AdminToken" }
        } | Out-Null
    }

    Write-Section "8. Book requests & notifications"
    if ($UserToken -and $AdminBookTitle) {
        $BookRequest = Invoke-Step "POST /api/book-requests" {
            Invoke-Json POST "$BaseUrl/api/book-requests" -Headers @{ Authorization = "Bearer $UserToken" } `
                -Body @{ bookTitle = $AdminBookTitle }
        }
        if ($BookRequest) {
            $BookRequestId = $BookRequest._id
        }
    }

    if ($AdminToken -and $BookRequestId) {
        Invoke-Step "GET /api/book-requests/admin/all" {
            Invoke-RestMethod "$BaseUrl/api/book-requests/admin/all" -Headers @{ Authorization = "Bearer $AdminToken" }
        } | Out-Null

        Invoke-Step "PUT /api/book-requests/admin/:id" {
            Invoke-Json PUT "$BaseUrl/api/book-requests/admin/$BookRequestId" -Headers @{ Authorization = "Bearer $AdminToken" } `
                -Body @{ status = 'Approved' }
        } | Out-Null

        if ($AdminBookId) {
            Invoke-Step "POST /api/book-requests/notify-users/:bookId" {
                Invoke-Json POST "$BaseUrl/api/book-requests/notify-users/$AdminBookId" -Headers @{ Authorization = "Bearer $AdminToken" }
            } | Out-Null
        }

        Invoke-Step "GET /api/book-requests/admin/notifications" {
            Invoke-RestMethod "$BaseUrl/api/book-requests/admin/notifications" -Headers @{ Authorization = "Bearer $AdminToken" }
        } | Out-Null
    }

    if ($UserToken) {
        $notifications = Invoke-Step "GET /api/book-requests/notifications" {
            Invoke-RestMethod "$BaseUrl/api/book-requests/notifications" -Headers @{ Authorization = "Bearer $UserToken" }
        }
        if ($notifications) {
            $NotificationIds = $notifications | ForEach-Object { $_._id }
            if ($NotificationIds.Count -gt 0) {
                Invoke-Step "PATCH /api/users/requests/:id/viewed" {
                    Invoke-Json PATCH "$BaseUrl/api/users/requests/$($NotificationIds[0])/viewed" `
                        -Headers @{ Authorization = "Bearer $UserToken" }
                } | Out-Null
            }
            if ($NotificationIds.Count -gt 1) {
                Invoke-Step "DELETE /api/users/requests/:id" {
                    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/users/requests/$($NotificationIds[1])" `
                        -Headers @{ Authorization = "Bearer $UserToken" }
                } | Out-Null
            }
        }

        Invoke-Step "PUT /api/book-requests/notifications/mark-read" {
            Invoke-Json PUT "$BaseUrl/api/book-requests/notifications/mark-read" `
                -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null

        Invoke-Step "POST /api/book-requests/clear-notifications" {
            Invoke-Json POST "$BaseUrl/api/book-requests/clear-notifications" `
                -Headers @{ Authorization = "Bearer $UserToken" }
        } | Out-Null
    }

    Write-Section "9. Admin maintenance"
    if ($AdminToken) {
        Invoke-Step "GET /api/admin/users" {
            Invoke-RestMethod "$BaseUrl/api/admin/users" -Headers @{ Authorization = "Bearer $AdminToken" }
        } | Out-Null

        if ($ApiUserId) {
            Invoke-Step "PUT /api/admin/users/:id/make-admin" {
                Invoke-Json PUT "$BaseUrl/api/admin/users/$ApiUserId/make-admin" `
                    -Headers @{ Authorization = "Bearer $AdminToken" }
            } | Out-Null

            Invoke-Step "DELETE /api/admin/users/:id" {
                Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/admin/users/$ApiUserId" `
                    -Headers @{ Authorization = "Bearer $AdminToken" }
            } | Out-Null
        }
    }

    Write-Section "10. Admin book management"
    if ($AdminToken -and $AdminBook2Id) {
        Invoke-Step "PUT /api/books/:id/admin" {
            Invoke-Json PUT "$BaseUrl/api/books/$AdminBook2Id/admin" `
                -Headers @{ Authorization = "Bearer $AdminToken" } `
                -Body @{
                    title = "Updated Smoke Admin Book"
                    author = "Automation Bot"
                    description = "Updated by smoke test"
                    genres = '["automation","testing"]'
                }
        } | Out-Null

        Invoke-Step "PUT /api/books/:id/toc (admin)" {
            Invoke-Json PUT "$BaseUrl/api/books/$AdminBook2Id/toc" -Headers @{ Authorization = "Bearer $AdminToken" } `
                -Body @{ toc = @(@{ title = "Intro"; page = 1 }) }
        } | Out-Null
    }

    Write-Section "11. Clubs cleanup"
    if ($AdminToken -and $AdminClub2Id) {
        Invoke-Step "DELETE /api/clubs/:id (club2)" {
            Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/clubs/$AdminClub2Id" -Headers @{ Authorization = "Bearer $AdminToken" }
        } | Out-Null
        $CreatedClubIds.Remove($AdminClub2Id) | Out-Null
    }
    if ($AdminToken -and $AdminClubId) {
        Invoke-Step "DELETE /api/clubs/:id (club1)" {
            Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/clubs/$AdminClubId" -Headers @{ Authorization = "Bearer $AdminToken" }
        } | Out-Null
        $CreatedClubIds.Remove($AdminClubId) | Out-Null
    }

    Write-Section "12. Book cleanup"
    if ($AdminToken) {
        foreach ($bookId in @($AdminBook2Id, $AdminBookId)) {
            if ($bookId) {
                Invoke-Step "DELETE /api/books/$bookId/admin" {
                    Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/books/$bookId/admin" -Headers @{ Authorization = "Bearer $AdminToken" }
                } | Out-Null
                $CreatedBookIds.Remove($bookId) | Out-Null
            }
        }
    }

    Write-Section "13. AI assistant"
    if ($UserToken) {
        $aiPrompt = "Hi, how are you?"
        if ([string]::IsNullOrWhiteSpace($env:GROQ_API_KEY)) {
            Pass "POST /api/ai/chat (skipped - GROQ_API_KEY not set)"
        } else {
            $aiResponse = Invoke-Step "POST /api/ai/chat" {
                Invoke-Json POST "$BaseUrl/api/ai/chat" -Headers @{ Authorization = "Bearer $UserToken" } `
                    -Body @{ message = $aiPrompt }
            }
            if ($aiResponse) {
                $preview = $null
                $preview = Get-OptionalProperty $aiResponse 'response'
                if (-not $preview) { $preview = Get-OptionalProperty $aiResponse 'reply' }
                if (-not $preview) { $preview = Get-OptionalProperty $aiResponse 'answer' }
                if (-not $preview) { $preview = Get-OptionalProperty $aiResponse 'message' }
                if (-not $preview) { $preview = Get-OptionalProperty $aiResponse 'text' }

                if (-not $preview) {
                    $choices = Get-OptionalProperty $aiResponse 'choices'
                    if ($choices) {
                        $choiceList = @($choices)
                        if ($choiceList.Count -gt 0) {
                            $choice = $choiceList[0]
                            if ($choice) {
                                $choiceMessage = Get-OptionalProperty $choice 'message'
                                if ($choiceMessage) {
                                    $content = Get-OptionalProperty $choiceMessage 'content'
                                    if (-not $content) { $content = Get-OptionalProperty $choiceMessage 'text' }
                                    if (-not $content -and ($choiceMessage -is [string])) { $content = $choiceMessage }
                                    if ($content) { $preview = $content }
                                }
                                if (-not $preview) {
                                    $choiceText = Get-OptionalProperty $choice 'text'
                                    if ($choiceText) { $preview = $choiceText }
                                }
                            }
                        }
                    }
                }

                $previewString = if ($preview) { [string]$preview } else { $null }
                if (-not [string]::IsNullOrWhiteSpace($previewString)) {
                    if ($previewString.Length -gt 100) {
                        $previewString = $previewString.Substring(0, 100) + "..."
                    }
                    Write-Host ("    AI reply: " + $previewString)
                }
            }
        }
    }
} finally {
    Write-Section "Cleanup"

    if ($AdminToken) {
        foreach ($clubId in $CreatedClubIds) {
            try {
                Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/clubs/$clubId" -Headers @{ Authorization = "Bearer $AdminToken" } | Out-Null
            } catch {}
        }
        foreach ($bookId in $CreatedBookIds) {
            try {
                Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/books/$bookId/admin" -Headers @{ Authorization = "Bearer $AdminToken" } | Out-Null
            } catch {}
        }
        foreach ($userId in $CreatedUserIds) {
            try {
                Invoke-RestMethod -Method Delete -Uri "$BaseUrl/api/admin/users/$userId" -Headers @{ Authorization = "Bearer $AdminToken" } | Out-Null
            } catch {}
        }
    }

    foreach ($file in @($TempCover, $TempPdf, $TempAvatar) + $TempDownloads) {
        if ($file -and (Test-Path $file)) {
            try { Remove-Item $file -Force } catch {}
        }
    }
}

Write-Section "Smoke test complete."
if ($Failures.Count -gt 0) {
    Write-Host "`nThe following checks failed:" -ForegroundColor Yellow
    $Failures | Sort-Object -Unique | ForEach-Object { Write-Host " - $_" -ForegroundColor Yellow }
    exit 1
} else {
    Write-Host "`nAll API smoke tests passed." -ForegroundColor Green
    exit 0
}

