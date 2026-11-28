using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;

namespace Aidn.StandardOperator
{
    public static class WindowsEnrollment
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct RelyingParty { public uint Version; public string Id, Name, Icon; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct User { public uint Version, IdLength; public IntPtr Id; public string Name, Icon, DisplayName; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct Algorithm { public uint Version; public string Type; public int Code; }

        [StructLayout(LayoutKind.Sequential)]
        private struct List { public uint Count; public IntPtr Items; }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct ClientData { public uint Version, Length; public IntPtr Data; public string HashAlgorithm; }

        [StructLayout(LayoutKind.Sequential)]
        private struct Options
        {
            public uint Version, TimeoutMs;
            public List ExcludedCredentials, Extensions;
            public uint Attachment, RequireResidentKey, Verification, Attestation, Flags;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct Attestation
        {
            public uint Version;
            public IntPtr Format;
            public uint AuthenticatorDataLength;
            public IntPtr AuthenticatorData;
        }

        [DllImport("webauthn.dll")]
        private static extern int WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable([MarshalAs(UnmanagedType.Bool)] out bool available);

        [DllImport("webauthn.dll")]
        private static extern int WebAuthNAuthenticatorMakeCredential(IntPtr window, ref RelyingParty rp, ref User user,
            ref List algorithms, ref ClientData clientData, ref Options options, out IntPtr attestation);

        [DllImport("webauthn.dll")]
        private static extern void WebAuthNFreeCredentialAttestation(IntPtr attestation);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();

        public static bool Available()
        {
            bool available;
            return WebAuthNIsUserVerifyingPlatformAuthenticatorAvailable(out available) == 0 && available;
        }

        public sealed class Credential
        {
            public string Id { get; set; }
            public string PublicKey { get; set; }
        }

        public static Credential Create(string displayName, byte[] userId, byte[] clientJson)
        {
            if (!Available()) throw new InvalidOperationException("STANDARD_WINDOWS_OPERATOR_AUTHENTICATOR_UNAVAILABLE");
            var userHandle = GCHandle.Alloc(userId, GCHandleType.Pinned);
            var dataHandle = GCHandle.Alloc(clientJson, GCHandleType.Pinned);
            var keyAlgorithm = new Algorithm { Version = 1, Type = "public-key", Code = -7 };
            var algorithm = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Algorithm)));
            IntPtr result = IntPtr.Zero;
            Marshal.StructureToPtr(keyAlgorithm, algorithm, false);
            try
            {
                // Direct Windows enrollment. The browser and the requesting
                // agent supply neither the credential id nor its public key.
                var rp = new RelyingParty { Version = 1, Id = "localhost", Name = "AIDN" };
                var user = new User { Version = 1, IdLength = (uint)userId.Length, Id = userHandle.AddrOfPinnedObject(),
                    Name = displayName, DisplayName = displayName };
                var algorithms = new List { Count = 1, Items = algorithm };
                var clientData = new ClientData { Version = 1, Length = (uint)clientJson.Length,
                    Data = dataHandle.AddrOfPinnedObject(), HashAlgorithm = "SHA-256" };
                var options = new Options { Version = 1, TimeoutMs = 120000, Attachment = 1, RequireResidentKey = 1,
                    Verification = 1, Attestation = 1 };
                int status = WebAuthNAuthenticatorMakeCredential(GetConsoleWindow(), ref rp, ref user, ref algorithms,
                    ref clientData, ref options, out result);
                if (status != 0 || result == IntPtr.Zero)
                    throw new InvalidOperationException("STANDARD_WINDOWS_OPERATOR_ENROLLMENT_FAILED_0x" + status.ToString("X8"));
                var attestation = (Attestation)Marshal.PtrToStructure(result, typeof(Attestation));
                if (attestation.AuthenticatorDataLength < 56 || attestation.AuthenticatorDataLength > 8192 ||
                    attestation.AuthenticatorData == IntPtr.Zero) throw InvalidCredential();
                var data = new byte[attestation.AuthenticatorDataLength];
                Marshal.Copy(attestation.AuthenticatorData, data, 0, data.Length);
                return ReadCredential(data);
            }
            finally
            {
                if (result != IntPtr.Zero) WebAuthNFreeCredentialAttestation(result);
                Marshal.DestroyStructure(algorithm, typeof(Algorithm));
                Marshal.FreeHGlobal(algorithm);
                dataHandle.Free();
                userHandle.Free();
            }
        }

        private static Credential ReadCredential(byte[] data)
        {
            byte[] rpHash;
            using (var sha = SHA256.Create()) rpHash = sha.ComputeHash(Encoding.UTF8.GetBytes("localhost"));
            for (int i = 0; i < rpHash.Length; i++) if (data[i] != rpHash[i]) throw InvalidCredential();
            if ((data[32] & 0x45) != 0x45 || (data[32] & 0x80) != 0) throw InvalidCredential();

            // rpIdHash, flags, signCount and AAGUID precede the id length.
            int idLength = (data[53] << 8) | data[54];
            if (idLength < 12 || idLength > 1024 || data.Length < 56 + idLength) throw InvalidCredential();
            var id = new byte[idLength];
            Buffer.BlockCopy(data, 55, id, 0, id.Length);
            var reader = new CoseReader(data, 55 + idLength);
            if (reader.Read(5) != 5) throw InvalidCredential();
            var fields = new HashSet<int>();
            byte[] x = null, y = null;
            for (int i = 0; i < 5; i++)
            {
                int field = reader.Integer();
                if (!fields.Add(field)) throw InvalidCredential();
                switch (field)
                {
                    case 1: if (reader.Integer() != 2) throw InvalidCredential(); break;
                    case 3: if (reader.Integer() != -7) throw InvalidCredential(); break;
                    case -1: if (reader.Integer() != 1) throw InvalidCredential(); break;
                    case -2: x = reader.Coordinate(); break;
                    case -3: y = reader.Coordinate(); break;
                    default: throw InvalidCredential();
                }
            }
            if (!reader.Done || x == null || y == null) throw InvalidCredential();
            // DER SubjectPublicKeyInfo for an uncompressed ES256 point.
            byte[] spkiPrefix = { 0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01,
                0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00, 0x04 };
            var spki = new byte[91];
            Buffer.BlockCopy(spkiPrefix, 0, spki, 0, spkiPrefix.Length);
            Buffer.BlockCopy(x, 0, spki, spkiPrefix.Length, 32);
            Buffer.BlockCopy(y, 0, spki, spkiPrefix.Length + 32, 32);
            return new Credential { Id = Base64Url(id), PublicKey = Base64Url(spki) };
        }

        private static string Base64Url(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        private static InvalidOperationException InvalidCredential()
        {
            return new InvalidOperationException("STANDARD_WINDOWS_OPERATOR_CREDENTIAL_INVALID");
        }

        private sealed class CoseReader
        {
            private readonly byte[] data;
            private int position;
            public CoseReader(byte[] data, int position) { this.data = data; this.position = position; }
            public bool Done { get { return position == data.Length; } }
            private byte Next() { if (Done) throw InvalidCredential(); return data[position++]; }
            public int Read(int major)
            {
                int next = Next();
                if ((next >> 5) != major) throw InvalidCredential();
                int value = next & 31;
                if (value == 24) return Next();
                if (value < 24) return value;
                throw InvalidCredential();
            }
            public int Integer()
            {
                if (Done) throw InvalidCredential();
                int major = data[position] >> 5;
                if (major == 0) return Read(0);
                return -1 - Read(1);
            }
            public byte[] Coordinate()
            {
                if (Read(2) != 32 || data.Length - position < 32) throw InvalidCredential();
                var point = new byte[32];
                Buffer.BlockCopy(data, position, point, 0, point.Length);
                position += point.Length;
                return point;
            }
        }
    }
}
